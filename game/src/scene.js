// The three.js renderer, camera, sky and lights. One directional sun (the only
// shadow caster) plus a hemisphere fill and a few warm lamps; a gradient sky dome
// and a low sun sprite sell the dusk hour. Nothing here knows about the game state.
import * as THREE from 'three';
import { CONFIG } from './config.js';

const P = CONFIG.palette;

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x3a4666, 0.011);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 220);

  // Gradient sky dome: deep blue above, warm horizon below.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(150, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(P.skyTop) },
        horizon: { value: new THREE.Color(P.horizon) },
      },
      vertexShader: 'varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vPos; void main() { float h = clamp(normalize(vPos).y * 1.6 + 0.18, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.7)), 1.0); }',
    }),
  );
  scene.add(sky);

  // Low sun sprite in the west.
  const sunCanvas = document.createElement('canvas');
  sunCanvas.width = 128;
  sunCanvas.height = 128;
  const g = sunCanvas.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,220,160,1)');
  grad.addColorStop(0.25, 'rgba(255,180,84,0.85)');
  grad.addColorStop(1, 'rgba(255,150,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const sunTex = new THREE.CanvasTexture(sunCanvas);
  sunTex.colorSpace = THREE.SRGBColorSpace;
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  sunSprite.scale.set(34, 34, 1);
  sunSprite.position.set(-90, 14, 25);
  scene.add(sunSprite);

  const hemi = new THREE.HemisphereLight(P.skyTop, P.ground, 1.3);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(P.sun, 2.8);
  sun.position.set(-30, 18, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -36;
  sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 36;
  sun.shadow.camera.bottom = -36;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);

  // Cool fill from the north-east: lifts the shadow sides the camera sees, so the
  // map reads at dusk instead of going black on the unlit faces.
  const fill = new THREE.DirectionalLight(0x8aa0c8, 0.5);
  fill.position.set(25, 20, -15);
  scene.add(fill);

  const lampPositions = [[-20, 3.4, -16], [20, 3.4, -16], [0, 3.4, 2], [0, 3.4, 24]];
  for (const [x, y, z] of lampPositions) {
    const lamp = new THREE.PointLight(P.lamp, 14, 18, 2);
    lamp.position.set(x, y, z);
    scene.add(lamp);
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, resize };
}
