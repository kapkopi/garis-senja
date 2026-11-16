// Pelabuhan Senja, the map: a dusk harbor yard, 64 by 64 metres, with three lanes.
// Attackers spawn in the south, defenders in the north. Site A is a warehouse in
// the west, site B a container dock in the east, and Mid is a courtyard between
// them, joined by a northern rotation passage. Every structure is a box or a
// cylinder built here from primitives; the same list drives both the meshes and the
// collision boxes, so what you see is what blocks you. Waypoints form the graph the
// bots walk: nodes in open ground, edges along the lanes.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { getTextures, makeGlowTexture } from './textures.js';

const P = CONFIG.palette;

function letterTexture(letter) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.strokeStyle = '#ffb454';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#ffb454';
  g.font = 'bold 64px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 64, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// [centerX, centerZ, width, depth, height, materialKey] — boxes sit on the ground.
const BOXES = [
  // Perimeter walls.
  [0, -31.5, 64, 1, 4, 'concrete'],
  [0, 31.5, 64, 1, 4, 'concrete'],
  [-31.5, 0, 1, 64, 4, 'concrete'],
  [31.5, 0, 1, 64, 4, 'concrete'],
  // Site A warehouse: three walls, open to the south and east.
  [-23, -16, 1, 12, 3.5, 'concrete'],
  [-20, -21.5, 7, 1, 3.5, 'concrete'],
  [-17, -19, 1, 6, 3.5, 'concrete'],
  [-21, -14, 2.2, 1.2, 1, 'wood'],
  [-18.5, -17.5, 1.2, 1.2, 1, 'wood'],
  [-19, -15, 1.2, 1.2, 2, 'wood'],
  // Site B dock: containers forming a U, open to the south and west.
  [23, -16, 1.2, 8, 2.6, 'metalRed'],
  [20, -21, 7, 1.2, 2.6, 'metalTeal'],
  [17.5, -18, 1.2, 5, 2.6, 'metalYellow'],
  [21, -14.5, 2.4, 1.2, 1.2, 'metalRed'],
  [18.5, -15.5, 1.2, 1.2, 1, 'wood'],
  // Mid courtyard: central container stack and crates.
  [0, -2, 6, 2.4, 2.6, 'metalTeal'],
  [-4, 2, 1.4, 1.4, 1, 'wood'],
  [4, 3, 1.4, 1.4, 1, 'wood'],
  [-3, -6, 1.4, 1.4, 1.2, 'wood'],
  [5, -6, 1.2, 1.2, 1, 'wood'],
  // West (A) lane blocks.
  [-24, 8, 1.2, 6, 2.6, 'metalYellow'],
  [-24, -2, 2, 1.2, 1, 'wood'],
  [-20, 6, 1.2, 1.2, 1, 'wood'],
  [-16, 12, 3, 1, 1.2, 'wood'],
  [-26, -8, 1.2, 5, 2.6, 'metalRed'],
  // East (B) lane blocks.
  [24, 8, 1.2, 6, 2.6, 'metalTeal'],
  [24, -2, 2, 1.2, 1, 'wood'],
  [20, 6, 1.2, 1.2, 1, 'wood'],
  [16, 12, 3, 1, 1.2, 'wood'],
  [26, -8, 1.2, 5, 2.6, 'metalYellow'],
  // Northern rotation passage walls (gaps at x -8, 0, 8 for crossings).
  [-14, -10, 8, 1, 2.2, 'concrete'],
  [14, -10, 8, 1, 2.2, 'concrete'],
  [-4, -10, 2, 1, 1, 'wood'],
  [4, -10, 2, 1, 1, 'wood'],
  // Spawn cover.
  [-6, 24, 2, 1, 1, 'wood'],
  [6, 24, 2, 1, 1, 'wood'],
  [-10, -24, 2, 1, 1, 'wood'],
  [10, -24, 2, 1, 1, 'wood'],
  // Hazard barriers at the site mouths.
  [-17, -12, 3, 0.4, 1, 'hazard'],
  [17, -12, 3, 0.4, 1, 'hazard'],
];

// [x, z, radius, height] — barrels, collided as squares.
const BARRELS = [
  [-14, 18, 0.5, 1.1],
  [14, 18, 0.5, 1.1],
  [-8, -14, 0.5, 1.1],
  [8, -14, 0.5, 1.1],
  [-22, 2, 0.5, 1.1],
  [22, 2, 0.5, 1.1],
];

// Waypoint graph: nodes in open ground, edges along walkable lanes.
const WAYPOINTS = [
  [-4, 26], [0, 26], [4, 26], // 0-2 attacker spawn
  [-16, 18], [0, 18], [16, 18], // 3-5 south crossings
  [-24, 12], [0, 10], [24, 12], // 6-8 lane mouths
  [-24, 0], [-12, 2], [0, 0], [12, 2], [24, 0], // 9-13 mid band
  [-20, -8], [0, -6], [20, -8], // 14-16 north of mid
  [-20, -16], [20, -16], // 17-18 sites A, B
  [-12, -14], [12, -14], // 19-20 site approaches
  [-8, -24], [8, -24], // 21-22 defender spawn
  [-12, -22], [12, -22], // 23-24 defender holds
  [-24, -12], [24, -12], // 25-26 site flanks
];
const EDGES = [
  [0, 3], [1, 4], [2, 5], [3, 4], [4, 5],
  [3, 6], [4, 7], [5, 8], [6, 9], [7, 11], [8, 13],
  [9, 10], [10, 11], [11, 12], [12, 13],
  [9, 14], [11, 15], [13, 16], [14, 17], [16, 18],
  [10, 14], [12, 16], [15, 19], [15, 20], [19, 17], [20, 18],
  [14, 25], [25, 17], [16, 26], [26, 18],
  [19, 23], [20, 24], [23, 21], [24, 22], [21, 22],
  [14, 19], [16, 20], [23, 14], [24, 16],
];

export function buildMap(scene) {
  const tex = getTextures();
  const mats = {
    concrete: new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 0.95 }),
    metalRed: new THREE.MeshStandardMaterial({ map: tex.metalRed, roughness: 0.6, metalness: 0.4 }),
    metalTeal: new THREE.MeshStandardMaterial({ map: tex.metalTeal, roughness: 0.6, metalness: 0.4 }),
    metalYellow: new THREE.MeshStandardMaterial({ map: tex.metalYellow, roughness: 0.6, metalness: 0.4 }),
    wood: new THREE.MeshStandardMaterial({ map: tex.wood, roughness: 0.9 }),
    hazard: new THREE.MeshStandardMaterial({ map: tex.hazard, roughness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: P.metalDark, roughness: 0.7, metalness: 0.5 }),
  };
  const colliders = [];
  const occluders = [];
  const group = new THREE.Group();
  group.name = 'map';

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 64),
    new THREE.MeshStandardMaterial({ map: tex.ground, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const [x, z, w, d, h, key] of BOXES) {
    const mesh = new THREE.Mesh(boxGeo, mats[key]);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    occluders.push(mesh);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: h });
  }
  // Barrels: cylinders with square collision boxes.
  const barrelGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.1, 12);
  const barrelMat = new THREE.MeshStandardMaterial({ color: P.containerRed, roughness: 0.6, metalness: 0.4 });
  for (const [x, z] of BARRELS) {
    const mesh = new THREE.Mesh(barrelGeo, barrelMat);
    mesh.position.set(x, 0.55, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    occluders.push(mesh);
    colliders.push({ minX: x - 0.5, maxX: x + 0.5, minZ: z - 0.5, maxZ: z + 0.5, top: 1.1 });
  }

  // Site markers: painted letters on the ground plus a glowing beacon pole.
  const sites = [
    { id: 'A', x: -20, z: -16 },
    { id: 'B', x: 20, z: -16 },
  ];
  const glowTex = makeGlowTexture([[0, 'rgba(255,200,120,1)'], [0.4, 'rgba(255,170,80,0.5)'], [1, 'rgba(255,150,60,0)']]);
  for (const site of sites) {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 5),
      new THREE.MeshBasicMaterial({ map: letterTexture(site.id), transparent: true, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(site.x, 0.02, site.z);
    group.add(decal);
    const px = site.x + (site.id === 'A' ? -2.5 : 2.5);
    const pz = site.z - 2.5;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.5, 8), mats.dark);
    pole.position.set(px, 2.25, pz);
    group.add(pole);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glow.scale.set(2.2, 2.2, 1);
    glow.position.set(px, 4.6, pz);
    group.add(glow);
  }

  // Water tower silhouette in the north-west corner, outside the lanes.
  const tower = new THREE.Group();
  tower.position.set(-26, 0, 8);
  const legGeo = new THREE.CylinderGeometry(0.15, 0.2, 7, 8);
  for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
    const leg = new THREE.Mesh(legGeo, mats.dark);
    leg.position.set(lx, 3.5, lz);
    leg.castShadow = true;
    tower.add(leg);
  }
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 2.6, 16), mats.dark);
  tank.position.y = 8.2;
  tank.castShadow = true;
  tower.add(tank);
  group.add(tower);
  colliders.push({ minX: -27.4, maxX: -24.6, minZ: 6.6, maxZ: 9.4, top: 7 });

  // Distant harbor skyline: dark boxes beyond the walls, no collision.
  const skylineMat = new THREE.MeshBasicMaterial({ color: 0x232c3d });
  const skyline = [[-45, -20, 10, 18], [-40, 15, 8, 12], [45, -25, 12, 22], [42, 20, 9, 14], [0, -48, 16, 10], [-15, 46, 12, 9], [20, 46, 10, 12]];
  for (const [x, z, w, h] of skyline) {
    const mesh = new THREE.Mesh(boxGeo, skylineMat);
    mesh.scale.set(w, h, w);
    mesh.position.set(x, h / 2, z);
    group.add(mesh);
  }

  scene.add(group);
  return {
    colliders,
    occluders,
    sites,
    spawns: {
      attackers: [[-4, 26], [0, 27], [4, 26]],
      defenders: [[-12, -24], [-4, -25], [4, -25], [12, -24]],
    },
    waypoints: WAYPOINTS.map(([x, z]) => ({ x, z })),
    edges: EDGES,
  };
}

// Axis-separated circle-vs-AABB slide. pos is {x, z} (feet), y is the feet height:
// a box only blocks when its top is above the feet, so jumping onto a crate works.
export function collideXZ(colliders, pos, radius, y, dx, dz) {
  pos.x += dx;
  for (const c of colliders) {
    if (c.top <= y + 0.01) continue;
    if (pos.x + radius > c.minX && pos.x - radius < c.maxX && pos.z + radius > c.minZ && pos.z - radius < c.maxZ) {
      pos.x = dx > 0 ? c.minX - radius : c.maxX + radius;
    }
  }
  pos.z += dz;
  for (const c of colliders) {
    if (c.top <= y + 0.01) continue;
    if (pos.x + radius > c.minX && pos.x - radius < c.maxX && pos.z + radius > c.minZ && pos.z - radius < c.maxZ) {
      pos.z = dz > 0 ? c.minZ - radius : c.maxZ + radius;
    }
  }
}

// The ground height under a point: the highest box top the point stands over, or 0.
export function groundHeight(colliders, x, z, y) {
  let g = 0;
  for (const c of colliders) {
    if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ && c.top <= y + 0.01 && c.top > g) g = c.top;
  }
  return g;
}

// BFS shortest path over the waypoint graph, as a list of node indices.
export function findPath(edges, nodeCount, from, to) {
  if (from === to) return [from];
  const prev = new Int16Array(nodeCount).fill(-1);
  const queue = [from];
  prev[from] = from;
  const adj = [];
  for (let i = 0; i < nodeCount; i++) adj.push([]);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  while (queue.length) {
    const cur = queue.shift();
    for (const next of adj[cur]) {
      if (prev[next] !== -1) continue;
      prev[next] = cur;
      if (next === to) {
        const path = [to];
        let n = to;
        while (n !== from) {
          n = prev[n];
          path.push(n);
        }
        path.reverse();
        return path;
      }
      queue.push(next);
    }
  }
  return [from, to];
}

export function nearestWaypoint(waypoints, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const dx = waypoints[i].x - x;
    const dz = waypoints[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
