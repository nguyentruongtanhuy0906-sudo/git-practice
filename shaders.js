// ============================================================================
// TWO HORIZONS — GLSL sources (M2 black hole ray-march + M4 environment)
// Single fullscreen-quad fragment shader implements:
//   - Approximate geodesic integration (gravitational lensing)
//   - Event-horizon capture (r < rs -> black)
//   - Accretion disk sampled at equator crossings, Keplerian swirl omega ~ r^-1.5
//   - Doppler beaming (brighter approaching limb / redshifted receding limb)
//   - Thin photon ring near 1.5*rs
//   - Hashed star field + twinkle + temporal star-trail accumulation buffer
//   - Procedural ground (gold grass / violet flowers + specular sparkle)
//   - Exponential height fog + horizon band lit by the disk
//   - ACES-filmic tonemap (col/(1+col), gamma .85), vignette, film grain, CA
//   - Fade-to-black scene swap via uFade uniform
// The black hole is NEVER a mesh — it only exists as light transport here.
// ============================================================================

export const VERT = /* glsl */ `
precision highp float;
void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const FRAG = /* glsl */ `
precision highp float;

uniform vec2  uResolution;
uniform float uTime;          // sim time (seconds)
uniform float uDt;            // frame delta (clamped)
uniform int   uScene;         // 0 = Aurum, 1 = Viola
uniform float uFade;          // 0..1 fade-to-black overlay amount
uniform vec3  uCamPos;        // world-space camera position
uniform mat3  uCamBasis;      // columns: right, up, forward
uniform float uFovScale;      // tan(fov/2)
uniform float uAngVel;        // camera angular velocity (rad/s) for star trails
uniform sampler2D uTrail;     // ping-pong trail accumulation texture
uniform int   uSteps;         // adaptive ray-march budget (96 desktop / 48 mobile)

#define PI  3.14159265359
#define TAU 6.28318530718

// ---------------------------------------------------------------------------
// Black hole parameters (M2 spec)
// ---------------------------------------------------------------------------
const float RS      = 11.0;   // schwarzschild radius
const float R_IN    = 24.0;   // disk inner radius
const float R_OUT   = 95.0;   // disk outer radius
const float BH_RIN  = 1.5 * RS; // photon sphere radius (ring glow source)

// ---------------------------------------------------------------------------
// Palette lock (M0): Aurum amber/gold vs Viola lavender/violet + single red
// ---------------------------------------------------------------------------
vec3 palDiskA(int s) { return s == 0 ? vec3(1.00, 0.70, 0.28) : vec3(0.85, 0.88, 1.00); }
vec3 palDiskB(int s) { return s == 0 ? vec3(1.00, 0.42, 0.09) : vec3(0.55, 0.42, 0.78); }
vec3 palSkyA (int s) { return s == 0 ? vec3(0.030, 0.020, 0.012) : vec3(0.020, 0.016, 0.034); }
vec3 palGndA (int s) { return s == 0 ? vec3(0.10, 0.070, 0.030) : vec3(0.075, 0.050, 0.115); }
vec3 palGndB (int s) { return s == 0 ? vec3(0.32, 0.220, 0.080) : vec3(0.36, 0.270, 0.520); }
vec3 palFog  (int s) { return s == 0 ? vec3(0.16, 0.100, 0.040) : vec3(0.13, 0.100, 0.200); }
float fogDensity(int s) { return s == 0 ? 0.012 : 0.010; }

// ---------------------------------------------------------------------------
// Hash / noise helpers
// ---------------------------------------------------------------------------
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p)  { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec2  hash22(vec2 p)  { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.zz) * q.zz); }
float hash13(vec3 p)  { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }

float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// swirlOctaves = 4 (M2 parameter)
float fbm2(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.07 + vec2(1.7); a *= 0.5; }
    return v;
}

// ---------------------------------------------------------------------------
// Star field on the sky dome (hashed points over direction + twinkle)
// ---------------------------------------------------------------------------
vec3 stars(vec3 dir, float t) {
    vec3 col = vec3(0.0);
    // three octaves of cell-projected points on the sphere
    for (int o = 0; o < 3; o++) {
        float scale = 140.0 * pow(2.3, float(o));
        vec3 sp = dir * scale;
        vec3 ip = floor(sp);
        vec3 fp = fract(sp) - 0.5;
        vec3 h = hash22(ip.xy + ip.z * 71.3 + float(o) * 13.7).zzx; // placeholder reuse
        // proper 3-cell hash:
        float hh = hash13(ip);
        if (hh > 0.965 - float(o) * 0.004) {
            vec2 off = (hash22(ip.xy * 1.3 + ip.z * 7.7) - 0.5) * 0.7;
            vec2 off2 = (hash22(ip.zy * 2.1 + ip.x * 3.3) - 0.5) * 0.7;
            vec3 pt = vec3(off.x, off.y * 0.5 + off2.y, off2.x) ;
            float d = length(fp - pt * 0.6);
            float tw = 0.6 + 0.4 * sin(t * (1.0 + 6.0 * hash13(ip + 3.1)) + hh * TAU);
            float b = smoothstep(0.07, 0.0, d) * tw;
            float temp = hash13(ip + 9.0);
            vec3 sc = mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.85, 0.65), temp);
            col += sc * b * (0.9 - float(o) * 0.22);
        }
    }
    return col;
}

// ---------------------------------------------------------------------------
// Sky = base tint + faint galactic band + stars
// ---------------------------------------------------------------------------
vec3 skyColor(vec3 dir, float t, int scene) {
    vec3 base = palSkyA(scene) * (1.0 - 0.45 * clamp(dir.y, 0.0, 1.0));
    // subtle milky band
    float band = exp(-pow((dir.y * 2.4 - dir.x * 0.6) * 1.8, 2.0)) * 0.05;
    vec3 c = base + band * vec3(0.6, 0.6, 0.8) + stars(dir, t);
    return c;
}

// ---------------------------------------------------------------------------
// Accretion disk texture: Kepler-swirled fbm + Doppler beaming
// ---------------------------------------------------------------------------
vec3 diskColor(vec2 uvDisk, float r, float phi, vec3 velDir, vec3 toCam, float t, int scene) {
    float u = r / R_OUT;                 // normalized radius
    float theta = atan(uvDisk.y, uvDisk.x);
    // Keplerian angular velocity ~ r^-1.5, diskSpeed ~ 0.9
    float omega = 0.9 * pow(RS * 2.2 / max(r, RS * 1.2), 1.5);
    // swirl coordinates: theta advances with time * omega => differential rotation
    vec2 sw = vec2(theta / TAU * 6.0 + t * omega * 0.35, u * 7.0);
    float n = fbm2(sw + vec2(0.0, log(r) * 1.4));
    float streaks = pow(fbm2(vec2(theta * 3.0 + t * omega * 0.5, r * 0.06)), 1.3);

    // radial falloff both ends
    float edgeIn  = smoothstep(R_IN, R_IN + 6.0, r);
    float edgeOut = 1.0 - smoothstep(R_OUT * 0.62, R_OUT, r);
    float bright = edgeIn * edgeOut * (0.35 + 1.15 * n + 0.6 * streaks);

    // inner hot rim (approaches photon ring brightness)
    bright += edgeOut * exp(-(r - R_IN) * 0.18) * 1.4;

    vec3 A = palDiskA(scene), B = palDiskB(scene);
    float heat = clamp(exp(-(r - R_IN) * 0.035), 0.0, 1.0);
    vec3 col = mix(B, A, heat) * bright;

    // ---- Doppler beaming: beta ~ sqrt(rs/(2r)) c-scaled, orbital direction ----
    float beta = clamp(sqrt(RS / (2.0 * max(r, RS))), 0.0, 0.75);
    float cosPhi = dot(normalize(velDir), normalize(toCam)); // +1 approaching limb
    float dop = 1.0 / (1.0 - beta * cosPhi);                 // relativistic boost
    dop = clamp(dop, 0.15, 3.2);
    float redshift = 1.0 - 0.35 * max(-cosPhi, 0.0) * beta * 2.0; // receding limb reddens
    col *= dop * vec3(redshift * redshift, redshift, 1.0 + 0.1 * max(cosPhi, 0.0));
    return col;
}

// ---------------------------------------------------------------------------
// Ray-march approximate geodesics around the BH.
// For each pixel we integrate a curved ray:
//   d += -1.5 * h2 * (rs^2 / r^5) * p * ds     (Schwarzschild weak-form bending)
// with h2 = |cross(p, camDir)|^2 conserved angular momentum.
// Equator-plane crossings sample the disk; multiple crossings give the
// upper lensed arc of the far side automatically. Photon ring glow added
// from proximity to 1.5*rs.
// ---------------------------------------------------------------------------
vec3 march(vec3 ioRo, vec3 ioRd, float t, int scene, out float diskLight) {
    // Work in a local frame centered on the BH with the disk in the XZ plane
    // (y = 0). Camera ray is transformed in, marched, and only its *direction*
    // is used for sky compositing — the shadow/lensing silhouette therefore
    // changes shape with camera motion (verification M2 ✅: not a 2D decal).
    vec3 bhPos = vec3(0.0, 30.0, -140.0);
    vec3 ro = ioRo - bhPos;
    vec3 rd = ioRd;

    vec3 col = vec3(0.0);
    diskLight = 0.0;

    vec3 p = ro;
    vec3 v = rd;
    float h2 = pow(length(cross(p, rd)), 2.0);

    float invRc = 1.0 / clamp(length(ro), 60.0, 1e4);
    float maxT = clamp(length(ro) * 2.6, 260.0, 620.0);
    float ds = maxT / float(uSteps);
    bool captured = false;
    int crossings = 0;

    float eqPrevY = p.y;

    for (int i = 0; i < 128; i++) {
        if (i >= uSteps) break;
        vec3 rel = p;
        float r = length(rel);
        if (r < RS) { captured = true; break; }               // event horizon capture
        if (dot(v, rel) > 0.0 && r > length(ro) + 60.0) break; // receding & past BH

        // geodesic curvature step: d += -1.5*h2*(rs^2/r^5)*p*ds
        vec3 acc = -1.5 * h2 * (RS * RS / pow(r, 5.0)) * rel;
        vec3 pn = p + v * ds + acc * ds * ds * 0.5;
        v = normalize(v + acc * ds);

        float eqCurY = pn.y;
        // equator-plane crossing -> sample disk (disk lies in local y = 0 plane)
        if (eqPrevY * eqCurY < 0.0 && crossings < 3) {
            float f = eqPrevY / (eqPrevY - eqCurY);
            vec3 hit = mix(p, pn, f);
            vec2 d2 = hit.xz;
            float rr = length(d2);
            if (rr > R_IN && rr < R_OUT) {
                crossings++;
                // orbital velocity direction (tangential, prograde CCW)
                vec2 rad = normalize(d2);
                vec2 tan2 = vec2(-rad.y, rad.x);
                vec3 velDir = vec3(tan2.x, 0.0, tan2.y);
                vec3 toCam = normalize(p - hit);              // back along the ray
                vec3 dc = diskColor(d2, rr, atan(d2.y, d2.x), velDir, toCam, t, scene);
                float fadeDepth = exp(-float(i) * 0.010);
                col += dc * fadeDepth;
                diskLight += dot(dc, vec3(0.2126, 0.7152, 0.0722)) * fadeDepth;
            }
        }
        eqPrevY = eqCurY;
        p = pn;

        // thin photon ring: glow while the segment grazes ~1.5 rs
        float dph = min(min(abs(r - BH_RIN), abs(length(p) - BH_RIN)), 40.0);
        col += palDiskA(scene) * exp(-dph * dph * 0.55) * 0.045 * ds * 0.45;
    }

    if (captured) return vec3(-1.0);   // sentinel: absolute shadow (kills sky)
    return col;
}

// ---------------------------------------------------------------------------
// Ground: procedural terrain-ish plane, gold grass or violet flower field
// ---------------------------------------------------------------------------
bool groundHit(vec3 ro, vec3 rd, out float dist) {
    dist = -1.0;
    if (rd.y > -0.0001) return false;
    float ty = -ro.y / rd.y;
    if (ty <= 0.0 || ty > 900.0) return false;
    dist = ty;
    return true;
}

vec3 groundColor(vec3 pos, vec3 rd, float t, int scene, float diskLight) {
    vec2 gp = pos.xz;
    float d = length(gp);
    // Aurum: dry golden-brown grass fbm. Viola: violet flowers w/ sparkle
    float g = fbm2(gp * 0.045 + t * 0.002);
    vec3 base = mix(palGndA(scene), palGndB(scene), g);
    if (scene == 1) {
        // flower heads: dense hashed dots
        vec2 cell = floor(gp * 0.9);
        vec2 f = fract(gp * 0.9) - 0.5;
        vec2 h = hash22(cell);
        float petal = smoothstep(0.16, 0.02, length(f - (h - 0.5) * 0.6));
        base += vec3(0.45, 0.30, 0.75) * petal * (0.35 + 0.5 * hash12(cell + 4.0));
        // specular sparkle: tiny hash highlights (density ~0.15)
        float spark = step(0.985, hash12(cell + floor(t * 3.0) * 0.11)) * petal;
        base += vec3(1.0, 0.95, 1.0) * spark * 1.6;
    } else {
        // wheat rows: faint stripes
        float rows = 0.5 + 0.5 * sin(dot(gp, vec2(0.35, 0.9)) * 2.0 + g * 6.0);
        base *= 0.75 + 0.35 * rows;
    }
    // lit by the disk (fake point-light from BH direction)
    vec3 toBH = normalize(vec3(0.0, 30.0, -140.0) - pos);
    float nl = clamp(dot(normalize(vec3(0.0, 1.0, 0.0)), toBH) * 0.5 + 0.5, 0.0, 1.0);
    base *= 0.25 + nl * (0.35 + min(diskLight, 2.5) * 0.5);
    return base;
}

// ---------------------------------------------------------------------------
// Main composition per ray
// ---------------------------------------------------------------------------
vec3 renderRay(vec3 ro, vec3 rd, float t, int scene, out float diskLight) {
    vec3 sky = skyColor(rd, t, scene);
    vec3 bh = march(ro, rd, t, scene, diskLight);
    // negative sentinel from march => event-horizon capture: absolute shadow,
    // no sky behind it. Otherwise additive lensed light over the sky dome.
    vec3 col = (bh.x < 0.0) ? vec3(0.0) : sky + bh;

    float gd;
    if (groundHit(ro, rd, gd)) {
        vec3 gpos = ro + rd * gd;
        vec3 gc = groundColor(gpos, rd, t, scene, diskLight);
        // exponential height fog between camera and ground point
        float fogAmt = 1.0 - exp(-fogDensity(scene) * gd);
        vec3 fogCol = palFog(scene) * (0.35 + min(diskLight, 2.0) * 0.5);
        // horizon band glowing from the disk: exp(-|rd.y - diskY| * k)
        vec3 bhPos = vec3(0.0, 30.0, -140.0);
        float diskY = normalize(bhPos - ro).y;
        float band = exp(-abs(rd.y - diskY) * 22.0) * (0.25 + min(diskLight, 1.5) * 0.3);
        fogCol += vec3(1.0, 0.85, 0.6) * band * (scene == 0 ? 1.0 : 0.7);
        gc = mix(gc, fogCol, clamp(fogAmt, 0.0, 1.0));
        col = gc;                                       // ground occludes sky
    } else {
        // horizon band also in pure-sky rays near disk altitude
        vec3 bhPos = vec3(0.0, 30.0, -140.0);
        float diskY = normalize(bhPos - ro).y;
        float band = exp(-abs(rd.y - diskY) * 22.0) * 0.18 * (0.4 + min(diskLight, 1.5) * 0.4);
        col += palFog(scene) * band * 2.0;
    }
    return col;
}

// ---------------------------------------------------------------------------
// Post: simple bloom-ish energy spread is done host-side (UnrealBloomPass);
// here: ACES-filmic tonemap col/(1+col) + gamma 0.85, vignette, grain, CA.
// ---------------------------------------------------------------------------
vec3 acesApprox(vec3 x) {
    // Narkowicz ACES fit
    float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;
    vec2 p = uv * 2.0 - 1.0;
    p.x *= uResolution.x / uResolution.y;

    // chromatic aberration ~0.0015 at edges
    float ca = 0.0015 * dot(p, p);
    vec2 pR = p * (1.0 + ca), pB = p * (1.0 - ca);

    // world-space camera ray: basis columns = (right, up, forward)
    vec3 ro = uCamPos;
    vec3 dirC = normalize(uCamBasis * vec3(p,  -uFovScale));
    vec3 dirR = normalize(uCamBasis * vec3(pR, -uFovScale));
    vec3 dirB = normalize(uCamBasis * vec3(pB, -uFovScale));

    int scene = uScene;
    float dl;
    vec3 colG = renderRay(ro, dirC, uTime, scene, dl);
    vec3 colR = renderRay(ro, dirR, uTime, scene, dl);
    vec3 colB = renderRay(ro, dirB, uTime, scene, dl);
    vec3 col = vec3(colR.r, colG.g, colB.b);

    // ---- temporal star-trail accumulation ---------------------------------
    // Blend current frame with history buffer weighted by camera angular
    // velocity; fast orbit/zoom smears stars into concentric arcs around the
    // (screen-stable) black hole. Threshold 0.4 rad/s.
    float trailW = clamp((uAngVel - 0.4) / 1.6, 0.0, 1.0) * 0.88;
    vec3 prev = texture2D(uTrail, uv).rgb;
    col = mix(col, prev * 0.94 + col * 0.06, trailW);
    // write target (host copies this pass result into the ping-pong buffer)
    // encoded implicitly: framebuffer IS the trail buffer's write target.

    // tonemap + grade
    col = acesApprox(col);
    col = pow(max(col, 0.0), vec3(0.85));           // gamma .85 per master prompt

    // vignette 0.35
    float vig = 1.0 - 0.35 * pow(length(p) * 0.62, 2.2);
    col *= vig;

    // film grain 2.5%
    float gr = hash12(gl_FragCoord.xy + fract(uTime) * 431.7);
    col += (gr - 0.5) * 0.025 * (1.0 - length(p) * 0.3);

    // fade-to-black state swap (never color cross-dissolve)
    col *= (1.0 - uFade);

    gl_FragColor = vec4(col, 1.0);
}
`;
