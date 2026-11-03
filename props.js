// ============================================================================
// TWO HORIZONS — props.js  (M3: low-poly silhouettes as SDF-merged meshes)
// House (A-frame + chimney + porch posts), pickup truck, dog on porch,
// astronaut with a single red emissive on the back.
// Base material = near-black; windows = emissive mask with white-noise tile
// randomization (some lit, some dark — exactly like the reference).
// Emissive survives fog at distance (MeshBasicMaterial-style unlit glow).
// Poly budget: each prop well under 5k tris (silhouettes should be cheap).
// NOTE: the black hole is intentionally NOT here — lensing is light
// transport, not geometry (M3 principle).
// ============================================================================

import * as THREE from 'three';

const BLACK = 0x0a0908;

function matBase() {
    return new THREE.MeshStandardMaterial({
        color: BLACK, roughness: 0.9, metalness: 0.0,
    });
}
function matEmissive(color, intensity) {
    // Unlit emissive: never swallowed by fog/distance (verification M3 ✅)
    const m = new THREE.MeshBasicMaterial({ color });
    m.userData.emissiveIntensity = intensity; // 1.2–1.5 per spec
    return m;
}

function box(w, h, d, mat, x = 0, y = 0, z = 0, ry = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    return mesh;
}

// ---------------------------------------------------------------------------
// A-frame house ~ 8 × 5 × 6 units, glowing windows via noise-tiled mask
// ---------------------------------------------------------------------------
export function buildHouse(sceneIdx) {
    const grp = new THREE.Group();
    const base = matBase();
    const winMat = matEmissive(sceneIdx === 0 ? 0xffb060 : 0xcfc4ff, 1.35);

    // main body
    grp.add(box(8, 5, 6, base, 0, 2.5, 0));

    // A-frame roof: two slanted slabs + ridge
    const roofL = box(4.9, 0.35, 6.6, base, -1.9, 6.4, 0);
    roofL.rotation.z = 0.72;
    const roofR = box(4.9, 0.35, 6.6, base, 1.9, 6.4, 0);
    roofR.rotation.z = -0.72;
    grp.add(roofL, roofR);
    grp.add(box(0.6, 0.6, 6.8, base, 0, 7.55, 0));           // ridge beam

    // chimney
    grp.add(box(1.0, 2.6, 1.0, base, 2.6, 7.2, -1.4));
    grp.add(box(1.3, 0.3, 1.3, base, 2.6, 8.6, -1.4));

    // porch: deck + 2 posts + small roof
    grp.add(box(8.6, 0.35, 3.0, base, 0, 0.2, 4.3));         // deck
    grp.add(box(0.35, 3.4, 0.35, base, -3.6, 1.9, 5.6));     // post L
    grp.add(box(0.35, 3.4, 0.35, base, 3.6, 1.9, 5.6));      // post R
    grp.add(box(8.8, 0.3, 3.4, base, 0, 3.7, 4.5));          // porch roof

    // ---- emissive windows: white-noise tiles decide lit/unlit -------------
    // deterministic PRNG so the pattern is stable per scene load
    let seed = sceneIdx === 0 ? 1337 : 4242;
    const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
    const slots = [
        // front wall (z+)
        [-2.4, 2.6, 3.06, 0], [2.4, 2.6, 3.06, 0], [0, 5.4, 3.06, 0] /* gable */,
        // side walls
        [4.06, 2.6, -1.2, Math.PI / 2], [-4.06, 2.6, 1.2, Math.PI / 2],
    ];
    for (const [x, y, z, ry] of slots) {
        if (rnd() < 0.35) continue;                            // dark window
        const w = box(1.15, 1.15, 0.06, winMat, x, y, z, ry);
        grp.add(w);
    }
    // door on porch
    grp.add(box(1.2, 2.2, 0.1, winMat, 0, 1.3, 3.12));

    grp.userData.radius = 9;
    return grp;
}

// ---------------------------------------------------------------------------
// Pickup truck ~ 5 × 1.6 × 2
// ---------------------------------------------------------------------------
export function buildTruck() {
    const grp = new THREE.Group();
    const base = matBase();
    grp.add(box(5.0, 0.9, 2.0, base, 0, 0.75, 0));            // bed/body
    grp.add(box(2.2, 0.9, 1.9, base, -0.9, 1.6, 0));          // cab
    const wheel = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 10);
    for (const [x, z] of [[-1.5, 1.0], [-1.5, -1.0], [1.6, 1.0], [1.6, -1.0]]) {
        const w = new THREE.Mesh(wheel, base);
        w.rotation.x = Math.PI / 2;
        w.position.set(x, 0.55, z);
        grp.add(w);
    }
    // tiny warm headlight strip (emissive, survives distance)
    grp.add(box(0.5, 0.18, 0.06, matEmissive(0xffcf8a, 1.2), -2.53, 0.95, 0.6));
    grp.add(box(0.5, 0.18, 0.06, matEmissive(0xffcf8a, 1.2), -2.53, 0.95, -0.6));
    grp.userData.radius = 4;
    return grp;
}

// ---------------------------------------------------------------------------
// Dog (~0.6 unit) hidden on the porch — only visible when pushing in close
// ---------------------------------------------------------------------------
export function buildDog() {
    const grp = new THREE.Group();
    const base = matBase();
    grp.add(box(0.55, 0.28, 0.22, base, 0, 0.32, 0));         // torso
    grp.add(box(0.18, 0.18, 0.16, base, 0.32, 0.5, 0));       // head
    grp.add(box(0.06, 0.12, 0.06, base, 0.30, 0.62, 0.05));   // ear
    grp.add(box(0.06, 0.12, 0.06, base, 0.30, 0.62, -0.05));
    for (const [x, z] of [[0.2, 0.08], [0.2, -0.08], [-0.2, 0.08], [-0.2, -0.08]])
        grp.add(box(0.07, 0.22, 0.07, base, x, 0.1, z));      // legs
    grp.add(box(0.22, 0.05, 0.05, base, -0.36, 0.42, 0));     // tail
    grp.userData.radius = 0.8;
    return grp;
}

// ---------------------------------------------------------------------------
// Astronaut: sphere helmet + box body + ONE red emissive on the back
// accent #ff2d2d — the single red of the Viola palette (M0 lock)
// ---------------------------------------------------------------------------
export function buildAstronaut() {
    const grp = new THREE.Group();
    const base = matBase();
    const body = box(0.9, 1.5, 0.6, base, 0, 1.6, 0);
    grp.add(body);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 12), base);
    helmet.position.set(0, 2.7, 0);
    grp.add(helmet);
    // arms + legs
    grp.add(box(0.25, 1.0, 0.25, base, -0.65, 1.7, 0));
    grp.add(box(0.25, 1.0, 0.25, base, 0.65, 1.7, 0));
    grp.add(box(0.3, 0.9, 0.3, base, -0.24, 0.45, 0));
    grp.add(box(0.3, 0.9, 0.3, base, 0.24, 0.45, 0));
    // backpack with the single red emissive stripe (on the BACK, -z side
    // which faces away from default camera → glints as you orbit)
    grp.add(box(0.7, 0.9, 0.3, base, 0, 1.9, -0.5));
    grp.add(box(0.5, 0.12, 0.05, matEmissive(0xff2d2d, 1.5), 0, 2.15, -0.68));
    grp.userData.radius = 2.5;
    return grp;
}

// ---------------------------------------------------------------------------
// Flower field for Viola foreground (instanced cheap sprites → bokeh bloom
// picks them up; DOF blur handled host-side by bloom threshold trickery)
// ---------------------------------------------------------------------------
export function buildFlowerField(count = 900) {
    const geo = new THREE.PlaneGeometry(0.5, 0.5);
    const mat = new THREE.MeshBasicMaterial({
        color: 0xb39ddb, transparent: true, opacity: 0.85,
        side: THREE.DoubleSide, depthWrite: false,
    });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
        const r = 8 + Math.random() * 60;
        const a = Math.random() * Math.PI * 2;
        dummy.position.set(Math.cos(a) * r, 0.25 + Math.random() * 0.5, Math.sin(a) * r);
        dummy.rotation.set(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.4);
        const s = 0.5 + Math.random() * 1.2;
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    return inst;
}

// ---------------------------------------------------------------------------
// Assemble a full prop layout for a scene index. Returns {group, lights}
// ---------------------------------------------------------------------------
export function buildWorld(sceneIdx) {
    const root = new THREE.Group();
    if (sceneIdx === 0) {
        const house = buildHouse(0);
        house.position.set(-14, 0, -26);
        house.rotation.y = 0.35;
        const truck = buildTruck();
        truck.position.set(2, 0, -18);
        truck.rotation.y = -0.5;
        const dog = buildDog();
        // dog lives on the porch → only found by push-in (verification M3 ✅)
        dog.position.set(-14 + 3.2, 0.35, -26 + 4.0);
        dog.rotation.y = -2.4;
        root.add(house, truck, dog);
    } else {
        const astro = buildAstronaut();
        astro.position.set(6, 0, -22);
        astro.rotation.y = Math.PI - 0.4;   // facing BH, red back toward viewer
        root.add(astro, buildFlowerField());
    }
    // dim fill so silhouettes read against sky without lighting the black
    const amb = new THREE.AmbientLight(0x223, 0.35);
    const key = new THREE.DirectionalLight(0xffffff, 0.15);
    key.position.set(0, 30, -140);          // lit by the disk direction
    root.add(amb, key);
    return root;
}
