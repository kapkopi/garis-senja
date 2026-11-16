// Every tuning number for Garis Senja, in one frozen place. Modules read config;
// none of them keeps its own copy of a number that lives here.
export const CONFIG = Object.freeze({
  simDt: 1 / 60,
  maxSimSteps: 4,

  map: Object.freeze({ half: 32, siteHalf: 3 }),

  rounds: Object.freeze({
    buyTime: 12,
    roundTime: 100,
    bombTime: 35,
    plantTime: 3,
    defuseTime: 5,
    winsToWin: 5,
    maxRounds: 9,
    roundEndDelay: 3.5,
  }),

  economy: Object.freeze({
    start: 800,
    kill: 300,
    win: 1000,
    loss: 600,
    plantBonus: 300,
    max: 9999,
    armorPrice: 650,
    ammoPrice: 200,
  }),

  player: Object.freeze({
    hp: 100,
    walk: 4.2,
    sprint: 6.0,
    crouch: 2.1,
    accel: 40,
    friction: 10,
    airAccel: 8,
    gravity: 18,
    jumpVel: 6.5,
    radius: 0.35,
    heightStand: 1.7,
    heightCrouch: 1.1,
    eyeStand: 1.6,
    eyeCrouch: 1.0,
  }),

  bots: Object.freeze({
    allies: 2,
    enemies: 4,
    hp: 100,
    walk: 3.8,
    run: 5.2,
    radius: 0.35,
    height: 1.7,
    visionRange: 40,
    visionHalfFov: 50 * (Math.PI / 180),
    visionInterval: 0.15,
    hearShot: 25,
    hearSprint: 8,
    hearWalk: 3,
    reactionMin: 0.25,
    reactionMax: 0.5,
    aimErrorMin: 0.02,
    aimErrorMax: 0.05,
    burstMin: 3,
    burstMax: 5,
    burstPauseMin: 0.4,
    burstPauseMax: 0.7,
  }),

  weapons: Object.freeze({
    pistol: Object.freeze({
      key: 'pistol', name: 'P-9', slot: 1, price: 0, damage: 26, headMult: 2.5,
      mag: 12, reserveMax: 48, interval: 0.25, auto: false, reload: 1.4,
      spread: 0.008, moveSpread: 0.02, bloom: 0.004, recoil: 0.006,
      rangeFull: 30, rangeFar: 60, rangeMinMult: 0.6, adsSpreadMult: 0.7, adsFov: 62,
    }),
    smg: Object.freeze({
      key: 'smg', name: 'Kilat K-9', slot: 2, price: 1500, damage: 22, headMult: 2.5,
      mag: 30, reserveMax: 120, interval: 0.09, auto: true, reload: 2.0,
      spread: 0.02, moveSpread: 0.035, bloom: 0.005, recoil: 0.005,
      rangeFull: 20, rangeFar: 45, rangeMinMult: 0.55, adsSpreadMult: 0.65, adsFov: 58,
    }),
    rifle: Object.freeze({
      key: 'rifle', name: 'SR-7', slot: 3, price: 2500, damage: 32, headMult: 2.5,
      mag: 30, reserveMax: 90, interval: 0.12, auto: true, reload: 2.4,
      spread: 0.011, moveSpread: 0.03, bloom: 0.006, recoil: 0.008,
      rangeFull: 30, rangeFar: 60, rangeMinMult: 0.6, adsSpreadMult: 0.55, adsFov: 52,
    }),
    sniper: Object.freeze({
      key: 'sniper', name: 'LJ-2', slot: 4, price: 4500, damage: 95, headMult: 2.0,
      mag: 5, reserveMax: 15, interval: 1.2, auto: false, reload: 3.0,
      spread: 0.06, scopedSpread: 0.0005, moveSpread: 0.05, bloom: 0.02, recoil: 0.03,
      rangeFull: 60, rangeFar: 120, rangeMinMult: 0.85, adsSpreadMult: 1, adsFov: 22,
    }),
  }),

  grenades: Object.freeze({
    frag: Object.freeze({
      key: 'frag', name: 'Granat Ledak', price: 300, fuse: 2.5, radius: 6, maxDamage: 110,
    }),
    smoke: Object.freeze({
      key: 'smoke', name: 'Granat Asap', price: 300, duration: 12, radius: 4,
    }),
  }),

  palette: Object.freeze({
    skyTop: 0x1a2a4a,
    horizon: 0xff9a5c,
    sun: 0xffb454,
    ground: 0x3a3f45,
    concrete: 0x6b7280,
    containerRed: 0xa34a3a,
    containerTeal: 0x3a7d7c,
    containerYellow: 0xc9a227,
    wood: 0x7a5c3e,
    metalDark: 0x2c323a,
    elang: 0x4fd1c5,
    bayang: 0xe0655a,
    lamp: 0xffc878,
  }),
});

export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'sniper'];
