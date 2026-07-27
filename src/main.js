import * as THREE from 'three';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, getFirestore, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBzo13TnpsZczAFspjdKG6dzGeRiiYxotA', authDomain: 'fake-war-thunder.firebaseapp.com', projectId: 'fake-war-thunder',
  storageBucket: 'fake-war-thunder.firebasestorage.app', messagingSenderId: '7982655959', appId: '1:7982655959:web:e3a4e22a8a2c5f74e38392', measurementId: 'G-TKLW6RTTH0'
};

const teams = [
  { id: 'scarlet', name: 'SCARLET LEGION', short: 'SCARLET', color: '#ec4f4f', position: [-150, 0, -150], role: 'SCHNELLE PANZERDIVISION' },
  { id: 'cobalt', name: 'COBALT FLEET', short: 'COBALT', color: '#5191ef', position: [150, 0, -150], role: 'MARITIME EINSATZGRUPPE' },
  { id: 'gold', name: 'GOLDEN SQUADRON', short: 'GOLD', color: '#e0ae48', position: [-150, 0, 150], role: 'LUFTUNTERSTÜTZUNG' },
  { id: 'verdant', name: 'VERDANT GUARD', short: 'VERDANT', color: '#5dbb71', position: [150, 0, 150], role: 'SCHWERE ABWEHR' }
];
const vehicles = [
  { id: 'tank', title: 'M1A1 MAIN BATTLE TANK', type: 'PANZER', info: 'Hohe Panzerung · 120 mm Kanone', icon: '▰' },
  { id: 'jet', title: 'F-16 FIGHTER JET', type: 'JET', info: 'Luftüberlegenheit · Hohe Geschwindigkeit', icon: '△' },
  { id: 'boat', title: 'PT-91 PATROL BOAT', type: 'BOOT', info: 'Küstenkontrolle · Schnelle Wende', icon: '≋' }
];

const $ = (id) => document.getElementById(id);
const screens = ['lobby-screen', 'team-screen', 'vehicle-screen'];
const state = { team: null, vehicle: null, room: '', userId: null, playerName: '', db: null, multiplayer: false, players: new Map(), unsubscribePlayers: null, lastSync: 0 };

function showScreen(id) { screens.forEach((screen) => $(screen).classList.toggle('hidden', screen !== id)); }
function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('visible'), 3000); }
function roomCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char])); }
function getTeam(id) { return teams.find((team) => team.id === id); }
function playerRef() { return doc(state.db, 'lobbies', state.room, 'players', state.userId); }

function renderLobbyStatus() {
  const players = [...state.players.entries()].map(([id, player]) => ({ id, ...player }));
  $('player-count').textContent = `${players.length} / 16 SPIELER`;
  $('lobby-roster').innerHTML = players.length ? players.map((player) => {
    const team = getTeam(player.teamId); const isMe = player.id === state.userId;
    return `<div class="roster-player"><i style="--team:${team?.color || '#687a70'}"></i><span>${escapeHtml(player.name || 'Unbekannter Pilot')}${isMe ? ' <em>DU</em>' : ''}</span><small>${team?.short || 'WÄHLT TEAM'} · ${player.status === 'active' ? 'IM EINSATZ' : 'LOBBY'}</small></div>`;
  }).join('') : '<div class="roster-empty">Verbindung zur Lobby wird hergestellt …</div>';
}
function updateLocalPlayer(values) {
  if (!state.multiplayer || !state.db) return;
  setDoc(playerRef(), { name: state.playerName, ...values, updatedAt: serverTimestamp() }, { merge: true }).catch((error) => {
    console.error('Player sync failed', error); toast('Firestore konnte deinen Status nicht speichern.');
  });
}
function subscribeToPlayers() {
  state.unsubscribePlayers?.();
  state.unsubscribePlayers = onSnapshot(collection(state.db, 'lobbies', state.room, 'players'), (snapshot) => {
    state.players = new Map(snapshot.docs.map((entry) => [entry.id, entry.data()]));
    renderLobbyStatus();
    if (gameStarted) syncRemotePlayers();
  }, (error) => { console.error('Lobby subscription failed', error); toast('Kein Lesezugriff auf diese Lobby. Prüfe deine Firestore-Regeln.'); });
}
function renderTeams() {
  $('team-grid').innerHTML = teams.map((team) => `
    <button class="team-card ${state.team?.id === team.id ? 'selected' : ''}" data-team="${team.id}" style="--team:${team.color}">
      <span class="team-mark">◆</span><strong>${team.name}</strong><small>${team.role}</small><span class="team-join">AUSWÄHLEN →</span>
    </button>`).join('');
  document.querySelectorAll('[data-team]').forEach((element) => element.addEventListener('click', () => {
    state.team = getTeam(element.dataset.team); updateLocalPlayer({ teamId: state.team.id, status: 'lobby' }); renderTeams();
    $('deploy-button').disabled = false; $('deploy-button').textContent = `${state.team.short} WÄHLEN`;
  }));
}
function renderVehicles() {
  $('selected-team-label').textContent = state.team.name; $('selected-team-label').style.color = state.team.color;
  $('vehicle-grid').innerHTML = vehicles.map((vehicle) => `
    <button class="vehicle-card ${state.vehicle?.id === vehicle.id ? 'selected' : ''}" data-vehicle="${vehicle.id}">
      <span class="vehicle-icon">${vehicle.icon}</span><span><small>${vehicle.type}</small><strong>${vehicle.title}</strong><em>${vehicle.info}</em></span><b>›</b>
    </button>`).join('');
  document.querySelectorAll('[data-vehicle]').forEach((element) => element.addEventListener('click', () => {
    state.vehicle = vehicles.find((vehicle) => vehicle.id === element.dataset.vehicle); updateLocalPlayer({ vehicleId: state.vehicle.id, status: 'ready' }); renderVehicles();
    $('start-game').disabled = false; $('start-game').textContent = `${state.vehicle.type} DEPLOYEN`;
  }));
}

async function startFirebase() {
  try {
    const app = initializeApp(firebaseConfig); const credential = await signInAnonymously(getAuth(app));
    state.userId = credential.user.uid; state.db = getFirestore(app); state.multiplayer = true;
    $('connection-status').textContent = 'ONLINE · FIREBASE VERBUNDEN';
  } catch (error) {
    console.error('Firebase connection failed', error); $('connection-status').textContent = 'FIREBASE NICHT VERFÜGBAR';
  }
}
async function createLobby(joining) {
  state.playerName = $('pilot-name').value.trim() || 'Pilot';
  state.room = joining ? $('room-code').value.trim().toUpperCase() : roomCode();
  if (joining && !state.room) return toast('Gib einen Lobby-Code ein.');
  if (!state.multiplayer) return toast('Firebase ist noch nicht verbunden. Bitte einen Moment warten oder Auth prüfen.');
  try {
    const room = doc(state.db, 'lobbies', state.room); const existing = await getDoc(room);
    if (joining && !existing.exists()) return toast('Lobby nicht gefunden — prüfe den Code.');
    if (joining) {
      const members = await getDocs(collection(state.db, 'lobbies', state.room, 'players'));
      if (members.size >= 16) return toast('Diese Lobby ist bereits voll.');
    } else {
      await setDoc(room, { code: state.room, hostId: state.userId, phase: 'lobby', maxPlayers: 16, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    await setDoc(playerRef(), { name: state.playerName, teamId: null, vehicleId: null, status: 'lobby', joinedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    subscribeToPlayers(); $('lobby-title').textContent = `LOBBY ${state.room}`; showScreen('team-screen'); renderTeams();
  } catch (error) { console.error('Lobby join failed', error); toast('Lobby konnte nicht geöffnet werden. Prüfe Firestore-Regeln und Internetverbindung.'); }
}

$('create-lobby').addEventListener('click', () => createLobby(false));
$('join-lobby').addEventListener('click', () => createLobby(true));
$('deploy-button').addEventListener('click', () => { showScreen('vehicle-screen'); renderVehicles(); });
$('back-team').addEventListener('click', () => showScreen('team-screen'));
$('start-game').addEventListener('click', () => { showScreen('none'); $('hud').classList.remove('hidden'); beginGame(); });
$('leave-match').addEventListener('click', async () => { try { if (state.multiplayer) await deleteDoc(playerRef()); } catch (error) { console.warn('Could not remove lobby player', error); } state.unsubscribePlayers?.(); location.reload(); });

if (window.ironfrontUpdater) {
  window.ironfrontUpdater.onStatus((status) => {
    if (status.type === 'available') toast(status.message);
    if (status.type === 'downloaded') { $('update-message').textContent = status.message; $('update-banner').classList.remove('hidden'); }
  });
  $('install-update').addEventListener('click', () => window.ironfrontUpdater.install());
}

let scene, camera, renderer, tank, turret, clock, keys = {}, gameStarted = false;
const remotePlayers = new Map();
function makeBase(team) {
  const group = new THREE.Group(); group.position.set(team.position[0], 0, team.position[2]); const color = new THREE.Color(team.color);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(26, 30, 1.6, 6), new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(.35), metalness: .25, roughness: .7 })); pad.position.y = .7; group.add(pad);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(17, .45, 8, 48), new THREE.MeshBasicMaterial({ color })); ring.rotation.x = Math.PI / 2; ring.position.y = 1.6; group.add(ring);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(7, 18, 7), new THREE.MeshStandardMaterial({ color: '#263632', metalness: .55, roughness: .45 })); tower.position.y = 10; group.add(tower);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 12), new THREE.MeshBasicMaterial({ color })); beacon.position.y = 20; group.add(beacon);
  const light = new THREE.PointLight(color, 2.1, 40); light.position.y = 17; group.add(light);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(7, 4), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })); flag.position.set(5, 16, 0); group.add(flag); scene.add(group);
}
function createTank(color, isLocal = false) {
  const group = new THREE.Group(); const material = new THREE.MeshStandardMaterial({ color, metalness: .55, roughness: .4 }); const dark = new THREE.MeshStandardMaterial({ color: '#19221e', metalness: .7, roughness: .35 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(6, 1.7, 9), material); hull.position.y = 2.15; group.add(hull);
  const slope = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.1, 4), material); slope.position.set(0, 3.2, -1); slope.rotation.x = -.17; group.add(slope);
  const leftTrack = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.45, 9.5), dark); leftTrack.position.set(-3.15, 1.4, 0); group.add(leftTrack); const rightTrack = leftTrack.clone(); rightTrack.position.x = 3.15; group.add(rightTrack);
  const localTurret = new THREE.Group(); localTurret.position.y = 3.85; const turretBody = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.55, 1.35, 8), material); localTurret.add(turretBody);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.25, .32, 7, 12), dark); barrel.rotation.x = Math.PI / 2; barrel.position.z = -4.2; localTurret.add(barrel); group.add(localTurret); if (isLocal) turret = localTurret;
  const glow = new THREE.PointLight(color, 1.3, 8); glow.position.set(0, 2, -5); group.add(glow); return group;
}
function createJet(color) {
  const group = new THREE.Group(); const material = new THREE.MeshStandardMaterial({ color, metalness: .65, roughness: .28 });
  const fuselage = new THREE.Mesh(new THREE.ConeGeometry(1.25, 10, 16), material); fuselage.rotation.x = Math.PI / 2; group.add(fuselage);
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.05, 16, 12), new THREE.MeshStandardMaterial({ color: '#294751', metalness: .8, roughness: .12 })); cockpit.scale.set(.75, .55, 1.35); cockpit.position.set(0, .55, -1); group.add(cockpit);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(10, .22, 2.1), material); wing.position.z = 1.1; group.add(wing); const tailWing = new THREE.Mesh(new THREE.BoxGeometry(4, .16, 1), material); tailWing.position.z = 4; group.add(tailWing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(.15, 2.2, 1.9), material); tail.position.set(0, 1, 3.8); group.add(tail); const exhaust = new THREE.PointLight('#79b8ff', 2, 16); exhaust.position.z = 5.2; group.add(exhaust); return group;
}
function createBoat(color) {
  const group = new THREE.Group(); const material = new THREE.MeshStandardMaterial({ color, metalness: .45, roughness: .4 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(4.7, 1.25, 11), material); hull.position.y = 1; group.add(hull); const bow = new THREE.Mesh(new THREE.ConeGeometry(2.35, 4, 4), material); bow.rotation.x = Math.PI / 2; bow.position.set(0, 1, -6); group.add(bow);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2, 3.5), new THREE.MeshStandardMaterial({ color: '#d4ddd1', metalness: .45, roughness: .3 })); cabin.position.set(0, 2.3, .8); group.add(cabin);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(3.35, .8, 1), new THREE.MeshStandardMaterial({ color: '#21434c', metalness: .85, roughness: .08 })); glass.position.set(0, 2.5, -1); group.add(glass);
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(.18, .23, 3.5, 10), new THREE.MeshStandardMaterial({ color: '#1b2521', metalness: .75, roughness: .3 })); gun.rotation.x = Math.PI / 2; gun.position.set(0, 2.15, -4); group.add(gun); return group;
}
function createVehicle(vehicleId, teamId, isLocal = false) { const color = getTeam(teamId)?.color || '#d6ddd1'; if (vehicleId === 'jet') return createJet(color); if (vehicleId === 'boat') return createBoat(color); return createTank(color, isLocal); }
function makePilotLabel(name, color) {
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 64; const context = canvas.getContext('2d'); context.font = '700 28px sans-serif'; context.textAlign = 'center'; context.fillStyle = '#07100d'; context.fillRect(0, 7, 320, 46); context.fillStyle = color; context.fillText(name.slice(0, 18).toUpperCase(), 160, 39);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true })); sprite.scale.set(12, 2.4, 1); sprite.position.y = 11; return sprite;
}
function syncRemotePlayers() {
  if (!scene) return; const activeIds = new Set();
  state.players.forEach((player, id) => {
    if (id === state.userId || player.status !== 'active' || !player.position || !player.vehicleId || !player.teamId) return; activeIds.add(id);
    let remote = remotePlayers.get(id);
    if (!remote || remote.vehicleId !== player.vehicleId || remote.teamId !== player.teamId) {
      if (remote) scene.remove(remote.object); const object = createVehicle(player.vehicleId, player.teamId); object.add(makePilotLabel(player.name || 'Pilot', getTeam(player.teamId)?.color || '#ffffff')); scene.add(object);
      remote = { object, targetPosition: new THREE.Vector3(), targetRotation: 0, vehicleId: player.vehicleId, teamId: player.teamId }; remotePlayers.set(id, remote);
    }
    remote.targetPosition.set(player.position.x || 0, player.position.y || 0, player.position.z || 0); remote.targetRotation = player.rotationY || 0;
    if (!remote.initialized) { remote.object.position.copy(remote.targetPosition); remote.object.rotation.y = remote.targetRotation; remote.initialized = true; }
  });
  remotePlayers.forEach((remote, id) => { if (!activeIds.has(id)) { scene.remove(remote.object); remotePlayers.delete(id); } });
}
function addTerrain() {
  scene.fog = new THREE.Fog('#9ebfc4', 160, 530); scene.background = new THREE.Color('#9ebfc4');
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500, 64, 64), new THREE.MeshStandardMaterial({ color: '#344f3b', roughness: 1 })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(500, 46), new THREE.MeshStandardMaterial({ color: '#1d6674', metalness: .5, roughness: .15, transparent: true, opacity: .88 })); water.rotation.x = -Math.PI / 2; water.position.set(0, .08, 0); scene.add(water);
  const roadMat = new THREE.MeshStandardMaterial({ color: '#28332d', roughness: .95 }); for (const roadInfo of [[0, -105, 18, 290], [-105, 0, 290, 18], [105, 0, 290, 18]]) { const road = new THREE.Mesh(new THREE.BoxGeometry(roadInfo[2], .06, roadInfo[3]), roadMat); road.position.set(roadInfo[0], .13, roadInfo[1]); scene.add(road); }
  const mountainMat = new THREE.MeshStandardMaterial({ color: '#466252', roughness: .95 }); for (let i = 0; i < 70; i += 1) { const angle = (i / 70) * Math.PI * 2; const radius = 215 + (i % 4) * 14; const height = 15 + (i % 7) * 9; const mountain = new THREE.Mesh(new THREE.ConeGeometry(12 + (i % 5) * 5, height, 6), mountainMat); mountain.position.set(Math.cos(angle) * radius, height / 2 - 1, Math.sin(angle) * radius); mountain.rotation.y = i; scene.add(mountain); }
  const treeMat = new THREE.MeshStandardMaterial({ color: '#193e29', roughness: .85 }); for (let i = 0; i < 105; i += 1) { const x = -210 + ((i * 37) % 420); const z = -210 + ((i * 83) % 420); if (Math.abs(z) < 30 || (Math.abs(x) < 24 && z < -85)) continue; const height = 6 + (i % 5) * 2; const tree = new THREE.Mesh(new THREE.ConeGeometry(2.6 + (i % 3), height, 7), treeMat); tree.position.set(x, height / 2, z); scene.add(tree); }
}
function beginGame() {
  if (gameStarted) return; gameStarted = true; scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(61, innerWidth / innerHeight, .1, 1000);
  renderer = new THREE.WebGLRenderer({ canvas: $('game-canvas'), antialias: true }); renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene.add(new THREE.HemisphereLight('#d9f6ff', '#29402c', 2.1)); const sun = new THREE.DirectionalLight('#fff1d6', 2.8); sun.position.set(100, 170, 60); scene.add(sun); addTerrain(); teams.forEach(makeBase);
  turret = null; tank = createVehicle(state.vehicle.id, state.team.id, true); tank.position.set(state.team.position[0], state.vehicle.id === 'jet' ? 11 : state.vehicle.id === 'boat' ? 1 : 0, state.team.position[2] + 32); scene.add(tank);
  $('hud-team').textContent = state.team.name; $('hud-team').style.color = state.team.color; $('match-room').textContent = `ONLINE · ${state.room}`; $('vehicle-name').textContent = state.vehicle.title;
  clock = new THREE.Clock(); window.addEventListener('resize', resize); document.addEventListener('keydown', (event) => { keys[event.code] = true; }); document.addEventListener('keyup', (event) => { keys[event.code] = false; });
  $('game-canvas').addEventListener('click', () => $('game-canvas').requestPointerLock()); document.addEventListener('mousemove', (event) => { if (turret && document.pointerLockElement === $('game-canvas')) turret.rotation.y -= event.movementX * .006; });
  syncRemotePlayers(); syncLocalPlayer(true); animate(); toast('Online-Einsatz gestartet. Andere Spieler erscheinen automatisch auf der Karte.');
}
function syncLocalPlayer(force = false) {
  if (!state.multiplayer || !tank || (!force && performance.now() - state.lastSync < 100)) return; state.lastSync = performance.now();
  updateLocalPlayer({ status: 'active', teamId: state.team.id, vehicleId: state.vehicle.id, position: { x: Number(tank.position.x.toFixed(2)), y: Number(tank.position.y.toFixed(2)), z: Number(tank.position.z.toFixed(2)) }, rotationY: Number(tank.rotation.y.toFixed(4)), clientUpdatedAt: Date.now() });
}
function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); }
function animate() {
  requestAnimationFrame(animate); const delta = Math.min(clock.getDelta(), .05); let input = 0; if (keys.KeyW || keys.ArrowUp) input += 1; if (keys.KeyS || keys.ArrowDown) input -= 1;
  const steer = ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) - ((keys.KeyD || keys.ArrowRight) ? 1 : 0); const topSpeed = keys.ShiftLeft ? 33 : 19; if (input) tank.rotation.y += steer * delta * 1.35 * input; else if (steer) tank.rotation.y += steer * delta * .65;
  const speed = input * topSpeed; tank.translateZ(-speed * delta); tank.position.x = THREE.MathUtils.clamp(tank.position.x, -230, 230); tank.position.z = THREE.MathUtils.clamp(tank.position.z, -230, 230);
  if (state.vehicle.id === 'jet') tank.rotation.z = THREE.MathUtils.lerp(tank.rotation.z, -steer * .22, delta * 4); if (state.vehicle.id === 'boat') tank.position.y = 1 + Math.sin(performance.now() * .003) * .12;
  remotePlayers.forEach((remote) => { remote.object.position.lerp(remote.targetPosition, 1 - Math.pow(.001, delta)); const angle = Math.atan2(Math.sin(remote.targetRotation - remote.object.rotation.y), Math.cos(remote.targetRotation - remote.object.rotation.y)); remote.object.rotation.y += angle * Math.min(1, delta * 10); });
  const desired = new THREE.Vector3(0, state.vehicle.id === 'jet' ? 11 : 15, 25).applyAxisAngle(new THREE.Vector3(0, 1, 0), tank.rotation.y).add(tank.position); camera.position.lerp(desired, 1 - Math.pow(.001, delta)); camera.lookAt(tank.position.x, tank.position.y + 2, tank.position.z);
  $('speed').textContent = `${Math.round(Math.abs(speed) * 3.6)} KM/H`; $('player-dot').style.left = `${50 + tank.position.x / 5}%`; $('player-dot').style.top = `${50 + tank.position.z / 5}%`; syncLocalPlayer(); renderer.render(scene, camera);
}

startFirebase();
