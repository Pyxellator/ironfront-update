import * as THREE from 'three';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, getFirestore, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBzo13TnpsZczAFspjdKG6dzGeRiiYxotA', authDomain: 'fake-war-thunder.firebaseapp.com', projectId: 'fake-war-thunder',
  storageBucket: 'fake-war-thunder.firebasestorage.app', messagingSenderId: '7982655959', appId: '1:7982655959:web:e3a4e22a8a2c5f74e38392', measurementId: 'G-TKLW6RTTH0'
};

const MAP_SIZE = 3550;

const teams = [
  { id: 'scarlet', name: 'SCARLET LEGION', short: 'SCARLET', color: '#ec4f4f', position: [-1120, 0, -1120], role: 'SCHNELLE PANZERDIVISION' },
  { id: 'cobalt', name: 'COBALT FLEET', short: 'COBALT', color: '#5191ef', position: [1120, 0, -1120], role: 'MARITIME EINSATZGRUPPE' },
  { id: 'gold', name: 'GOLDEN SQUADRON', short: 'GOLD', color: '#e0ae48', position: [-1120, 0, 1120], role: 'LUFTUNTERSTÜTZUNG' },
  { id: 'verdant', name: 'VERDANT GUARD', short: 'VERDANT', color: '#5dbb71', position: [1120, 0, 1120], role: 'SCHWERE ABWEHR' }
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
  let updateAnswered = false;
  const applyUpdateStatus = (status) => {
    const screen = $('update-screen');
    if (status.type === 'checking') { $('update-title').textContent = 'SUCHE NACH UPDATES'; $('update-message').textContent = 'GitHub Releases werden geprüft …'; }
    if (status.type === 'available') { updateAnswered = true; $('update-title').textContent = 'UPDATE WIRD GELADEN'; $('update-message').textContent = status.message; }
    if (status.type === 'downloaded') { updateAnswered = true; $('update-title').textContent = 'UPDATE BEREIT'; $('update-message').textContent = status.message; }
    if (status.type === 'current' || status.type === 'error') { updateAnswered = true; $('update-title').textContent = status.type === 'current' ? 'SYSTEM AKTUELL' : 'OFFLINE-MODUS'; $('update-message').textContent = status.type === 'current' ? 'Die neueste Version ist installiert.' : status.message; setTimeout(() => screen.classList.add('hidden'), 900); }
  };
  window.ironfrontUpdater.onStatus(applyUpdateStatus);
  window.ironfrontUpdater.getStatus().then(applyUpdateStatus).catch(() => {});
  setTimeout(() => { if (!updateAnswered) { $('update-message').textContent = 'Updateprüfung übersprungen. Spiel wird gestartet.'; setTimeout(() => $('update-screen').classList.add('hidden'), 500); } }, 12000);
} else {
  $('update-screen').classList.add('hidden');
}

let scene, camera, renderer, tank, turret, clock, keys = {}, gameStarted = false;
let flight = null, cameraMode = 'third', cockpitInterior = null, lastGunShot = 0, lastMissileShot = 0;
const projectiles = [], explosions = [], worldColliders = [], tunnelVolumes = [], remotePlayers = new Map();
let destroyed = false, groundVelocity = 0;
let localVoiceStream = null, unsubscribeVoiceSignals = null;
const voicePeers = new Map();
function makeBase(team) {
  const heading = Math.atan2(team.position[0], team.position[2]); const group = new THREE.Group(); group.position.set(team.position[0] + Math.cos(heading) * 55, 0, team.position[2] - Math.sin(heading) * 55); const color = new THREE.Color(team.color);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(26, 30, 1.6, 6), new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(.35), metalness: .25, roughness: .7 })); pad.position.y = .7; group.add(pad);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(17, .45, 8, 48), new THREE.MeshBasicMaterial({ color })); ring.rotation.x = Math.PI / 2; ring.position.y = 1.6; group.add(ring);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(7, 18, 7), new THREE.MeshStandardMaterial({ color: '#263632', metalness: .55, roughness: .45 })); tower.position.y = 10; group.add(tower);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 12), new THREE.MeshBasicMaterial({ color })); beacon.position.y = 20; group.add(beacon);
  const light = new THREE.PointLight(color, 2.1, 40); light.position.y = 17; group.add(light);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(7, 4), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })); flag.position.set(5, 16, 0); group.add(flag); scene.add(group);
  const runway = new THREE.Group(); runway.position.set(team.position[0], .12, team.position[2]); runway.rotation.y = heading;
  const strip = new THREE.Mesh(new THREE.BoxGeometry(34, .2, 540), new THREE.MeshStandardMaterial({ color: '#202724', roughness: .92, metalness: .08 })); strip.receiveShadow = true; runway.add(strip);
  const edge = new THREE.MeshStandardMaterial({ color: '#c6d0c3', roughness: .7 }); for (const x of [-15.5, 15.5]) { const line = new THREE.Mesh(new THREE.BoxGeometry(.7, .08, 520), edge); line.position.set(x, .15, 0); runway.add(line); }
  for (let z = -240; z <= 240; z += 36) { const dash = new THREE.Mesh(new THREE.BoxGeometry(.7, .08, 16), edge); dash.position.set(0, .16, z); runway.add(dash); for (const x of [-18, 18]) { const lamp = new THREE.Mesh(new THREE.SphereGeometry(.28, 8, 6), new THREE.MeshBasicMaterial({ color: team.color })); lamp.position.set(x, .4, z); runway.add(lamp); } }
  const thresholdMaterial = new THREE.MeshBasicMaterial({ color: '#f1f3df' }); for (const x of [-10, -6, -2, 2, 6, 10]) { const threshold = new THREE.Mesh(new THREE.BoxGeometry(2.2, .09, 24), thresholdMaterial); threshold.position.set(x, .17, -247); runway.add(threshold); }
  const tunnel = new THREE.Group(); tunnel.position.z = -25;
  const rock = new THREE.MeshStandardMaterial({ color: '#354b40', roughness: 1, side: THREE.DoubleSide });
  const inner = new THREE.MeshStandardMaterial({ color: '#101816', roughness: .95, side: THREE.BackSide });
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(18, 18, 150, 24, 1, true, Math.PI / 2, Math.PI), inner); shell.rotation.x = Math.PI / 2; tunnel.add(shell);
  for (let z = -75; z <= 75; z += 12.5) {
    const arch = new THREE.Mesh(new THREE.TorusGeometry(18, 3.8, 7, 20, Math.PI), rock); arch.position.z = z; tunnel.add(arch);
    for (const x of [-18, 18]) { const pillar = new THREE.Mesh(new THREE.BoxGeometry(7.5, 18, 7.5), rock); pillar.position.set(x, 7, z); tunnel.add(pillar); }
  }
  const tunnelFloor = new THREE.Mesh(new THREE.BoxGeometry(34, .16, 150), new THREE.MeshStandardMaterial({ color: '#171d1b', roughness: .9 })); tunnelFloor.position.y = .08; tunnel.add(tunnelFloor);
  for (let z = -62; z <= 62; z += 25) for (const x of [-13.5, 13.5]) { const lamp = new THREE.PointLight(team.color, .9, 19); lamp.position.set(x, 5.5, z); tunnel.add(lamp); }
  runway.add(tunnel);
  for (const x of [-70, 70]) { const ridge = new THREE.Mesh(new THREE.ConeGeometry(52, 96, 8), rock); ridge.position.set(x, 47, -25); ridge.rotation.y = x; runway.add(ridge); }
  scene.add(runway);
  tunnelVolumes.push({ team, center: -25, halfLength: 82, halfWidth: 17 });
  for (const x of [-70, 70]) { const center = runway.localToWorld(new THREE.Vector3(x, 0, -25)); worldColliders.push({ x: center.x, z: center.z, radius: 40, height: 96, type: 'mountain' }); }
  worldColliders.push({ x: group.position.x, z: group.position.z, radius: 12, height: 23, type: 'base' });
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
  const group = new THREE.Group(); const material = new THREE.MeshStandardMaterial({ color, metalness: .72, roughness: .32 }); const dark = new THREE.MeshStandardMaterial({ color: '#17201e', metalness: .85, roughness: .2 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.82, 1.08, 9.5, 20), material); body.rotation.x = Math.PI / 2; body.position.z = -.2; body.castShadow = true; group.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(.84, 4.2, 20), material); nose.rotation.x = -Math.PI / 2; nose.position.z = -7; group.add(nose);
  const intake = new THREE.Mesh(new THREE.CylinderGeometry(.63, .7, 1.4, 18, 1, true), dark); intake.rotation.x = Math.PI / 2; intake.position.set(0, -.65, -2); group.add(intake);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), new THREE.MeshPhysicalMaterial({ color: '#7fb3bd', metalness: .35, roughness: .05, transmission: .25, transparent: true, opacity: .78 })); canopy.scale.set(.68, .52, 1.65); canopy.position.set(0, .82, -2.1); group.add(canopy);
  const wingGeometry = new THREE.BufferGeometry(); wingGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-.35,0,-1.5,-7,0,2.2,-.65,0,3.1,.35,0,-1.5,.65,0,3.1,7,0,2.2],3)); wingGeometry.setIndex([0,1,2,3,4,5]); wingGeometry.computeVertexNormals(); const wings = new THREE.Mesh(wingGeometry, material); wings.position.y = .05; wings.castShadow = true; group.add(wings);
  const stabilizer = new THREE.Mesh(new THREE.BoxGeometry(5.2, .14, 1.25), material); stabilizer.position.z = 4.1; group.add(stabilizer);
  const finGeometry = new THREE.BufferGeometry(); finGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,2.7,0,3.5,4.1,0,0,4.8],3)); finGeometry.setIndex([0,1,2]); finGeometry.computeVertexNormals(); const fin = new THREE.Mesh(finGeometry, material); fin.material.side = THREE.DoubleSide; group.add(fin);
  for (const x of [-3.7, 3.7]) { const missile = new THREE.Mesh(new THREE.CylinderGeometry(.14,.2,3.2,10), new THREE.MeshStandardMaterial({ color:'#d9ded8',metalness:.6,roughness:.3 })); missile.rotation.x = Math.PI/2; missile.position.set(x,-.45,.8); group.add(missile); }
  for (const x of [-1.65,1.65]) { const gear = new THREE.Mesh(new THREE.TorusGeometry(.26,.12,8,14), dark); gear.rotation.y = Math.PI/2; gear.position.set(x,-1,1.2); group.add(gear); }
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(.66,.82,1.3,20,1,true), dark); nozzle.rotation.x=Math.PI/2; nozzle.position.z=5; group.add(nozzle); const exhaust = new THREE.PointLight('#67aaff', 3.2, 22); exhaust.position.z = 5.7; group.add(exhaust); group.scale.setScalar(1.35); return group;
}

function createCockpitInterior() {
  const cockpit = new THREE.Group(); const dark = new THREE.MeshStandardMaterial({ color:'#111715',metalness:.55,roughness:.5 }); const glow = new THREE.MeshBasicMaterial({ color:'#9fec85' });
  const dashboard = new THREE.Mesh(new THREE.BoxGeometry(2.45,.65,1.1),dark); dashboard.position.set(0,-.72,-1.45); dashboard.rotation.x=-.16; cockpit.add(dashboard);
  for (let i=0;i<8;i+=1){ const display=new THREE.Mesh(new THREE.PlaneGeometry(.28,.18),i%3===0?glow:new THREE.MeshBasicMaterial({color:'#365f49'})); display.position.set(-.93+(i%4)*.62,-.55-Math.floor(i/4)*.25,-2.02); cockpit.add(display); }
  const hudGlass=new THREE.Mesh(new THREE.PlaneGeometry(1.1,.7),new THREE.MeshBasicMaterial({color:'#78ff9b',transparent:true,opacity:.16,side:THREE.DoubleSide})); hudGlass.position.set(0,-.12,-2.15); cockpit.add(hudGlass);
  const reticle=new THREE.Mesh(new THREE.RingGeometry(.11,.13,24),new THREE.MeshBasicMaterial({color:'#8cff9b',transparent:true,opacity:.85})); reticle.position.set(0,-.05,-2.17); cockpit.add(reticle);
  for(const x of [-1.28,1.28]){const strut=new THREE.Mesh(new THREE.BoxGeometry(.09,2.5,.09),dark);strut.position.set(x,.15,-1.4);strut.rotation.z=x>0?.42:-.42;cockpit.add(strut);} const top=new THREE.Mesh(new THREE.BoxGeometry(2.1,.1,.1),dark);top.position.set(0,1,-1.7);cockpit.add(top);
  return cockpit;
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
function fireProjectile(kind) {
  const now = performance.now(); const cooldown = kind === 'gun' ? 105 : 1250;
  if (!tank || destroyed || now - (kind === 'gun' ? lastGunShot : lastMissileShot) < cooldown) return;
  if (kind === 'gun') lastGunShot = now; else lastMissileShot = now;
  const color = kind === 'gun' ? '#ffe88b' : '#ff7a58';
  const geometry = kind === 'gun' ? new THREE.SphereGeometry(.16, 8, 8) : new THREE.CylinderGeometry(.24, .34, 3.2, 12);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color }));
  mesh.position.copy(tank.localToWorld(new THREE.Vector3(kind === 'gun' ? .45 : 1.7, kind === 'gun' ? 2.9 : 1.1, -5.8)));
  mesh.quaternion.copy(tank.quaternion); if (kind === 'missile') mesh.rotateX(Math.PI / 2);
  if (kind === 'missile') { const flame = new THREE.PointLight('#ff5b28', 5, 32); flame.position.y = -1.8; mesh.add(flame); }
  scene.add(mesh); const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(tank.quaternion).normalize();
  projectiles.push({ mesh, direction, speed: kind === 'gun' ? 260 : 125, born: now, kind, trailTimer: 0 });
  if (kind === 'missile') toast('RAKETE ABGEFEUERT');
}
function createExplosion(position, scale = 1) {
  const group = new THREE.Group(); group.position.copy(position);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(2.3 * scale, 18, 12), new THREE.MeshBasicMaterial({ color: '#fff1a1', transparent: true, opacity: 1 })); group.add(flash);
  const fire = new THREE.Mesh(new THREE.SphereGeometry(3.6 * scale, 16, 12), new THREE.MeshBasicMaterial({ color: '#ff5a1f', transparent: true, opacity: .85 })); group.add(fire);
  const smoke = new THREE.Mesh(new THREE.SphereGeometry(4.4 * scale, 14, 10), new THREE.MeshBasicMaterial({ color: '#202625', transparent: true, opacity: .72 })); group.add(smoke);
  const light = new THREE.PointLight('#ff6b2f', 12 * scale, 85 * scale); group.add(light);
  const fragments = [];
  for (let i = 0; i < 22; i += 1) { const fragment = new THREE.Mesh(new THREE.SphereGeometry(.16 * scale, 5, 4), new THREE.MeshBasicMaterial({ color: i % 2 ? '#ffb33b' : '#ff542b', transparent: true })); group.add(fragment); fragments.push({ mesh: fragment, velocity: new THREE.Vector3((Math.random() - .5) * 28, Math.random() * 22 + 5, (Math.random() - .5) * 28).multiplyScalar(scale) }); }
  scene.add(group); explosions.push({ group, flash, fire, smoke, light, fragments, age: 0, scale, trail: false });
}
function createMissileTrail(position) {
  const puff = new THREE.Mesh(new THREE.SphereGeometry(.4, 7, 5), new THREE.MeshBasicMaterial({ color: '#ffb35c', transparent: true, opacity: .72 })); puff.position.copy(position); scene.add(puff);
  explosions.push({ group: puff, flash: puff, fire: puff, smoke: puff, light: { intensity: 0 }, fragments: [], age: 0, scale: .08, trail: true });
}
function updateExplosions(delta) {
  for (let i = explosions.length - 1; i >= 0; i -= 1) {
    const effect = explosions[i]; effect.age += delta; const t = effect.age;
    if (effect.trail) { effect.group.scale.setScalar(1 + t * 4); effect.group.material.opacity = Math.max(0, .72 - t * 2.4); if (t > .3) { scene.remove(effect.group); explosions.splice(i, 1); } continue; }
    effect.flash.scale.setScalar(1 + t * 8); effect.flash.material.opacity = Math.max(0, 1 - t * 5); effect.fire.scale.setScalar(1 + t * 4); effect.fire.material.opacity = Math.max(0, .9 - t * .65); effect.smoke.scale.setScalar(.7 + t * 3.2); effect.smoke.position.y += delta * 4; effect.smoke.material.opacity = Math.max(0, .65 - t * .3); effect.light.intensity = Math.max(0, 12 * effect.scale * (1 - t / 1.1));
    effect.fragments.forEach((fragment) => { fragment.velocity.y -= 18 * delta; fragment.mesh.position.addScaledVector(fragment.velocity, delta); fragment.mesh.material.opacity = Math.max(0, 1 - t / 1.5); });
    if (t > 2.1) { scene.remove(effect.group); explosions.splice(i, 1); }
  }
}
function localRunwayPosition(position, team) {
  const heading = Math.atan2(team.position[0], team.position[2]); const dx = position.x - team.position[0]; const dz = position.z - team.position[2];
  return { x: Math.cos(heading) * dx - Math.sin(heading) * dz, z: Math.sin(heading) * dx + Math.cos(heading) * dz };
}
function isOnRunway(position) { return teams.some((team) => { const local = localRunwayPosition(position, team); return Math.abs(local.x) < 17 && Math.abs(local.z) < 270; }); }
function isInsideTunnel(position) { return tunnelVolumes.some((volume) => { const local = localRunwayPosition(position, volume.team); return Math.abs(local.x) < volume.halfWidth && Math.abs(local.z - volume.center) < volume.halfLength && position.y < 18; }); }
function findWorldCollision(position, radius = 2.5) { if (isInsideTunnel(position)) return null; return worldColliders.find((collider) => position.y < collider.height && Math.hypot(position.x - collider.x, position.z - collider.z) < collider.radius + radius); }
function respawnPlayer() {
  const heading = Math.atan2(state.team.position[0], state.team.position[2]); tank.position.set(state.team.position[0] + Math.sin(heading) * 205, state.vehicle.id === 'jet' ? 1.35 : state.vehicle.id === 'boat' ? 1 : 0, state.team.position[2] + Math.cos(heading) * 205); tank.rotation.set(0, heading, 0); tank.visible = true; destroyed = false; groundVelocity = 0;
  if (flight) Object.assign(flight, { speed: 0, throttle: 0, pitch: 0, roll: 0, verticalSpeed: 0, airborne: false }); toast('FAHRZEUG WIEDER EINSATZBEREIT');
}
function destroyPlayer(reason) { if (destroyed) return; destroyed = true; createExplosion(tank.position.clone().add(new THREE.Vector3(0, 2, 0)), state.vehicle.id === 'jet' ? 1.7 : 1.25); tank.visible = false; toast(`${reason} · RESPAWN IN 3 SEKUNDEN`); setTimeout(respawnPlayer, 3000); }
function updateProjectiles(delta) {
  const now = performance.now();
  for (let i = projectiles.length - 1; i >= 0; i -= 1) {
    const shot = projectiles[i]; shot.mesh.position.addScaledVector(shot.direction, shot.speed * delta);
    if (shot.kind === 'missile') { shot.mesh.rotateZ(delta * 8); shot.trailTimer -= delta; if (shot.trailTimer <= 0) { shot.trailTimer = .035; createMissileTrail(shot.mesh.position.clone().addScaledVector(shot.direction, -1.7)); } }
    const hit = shot.mesh.position.y <= .15 || findWorldCollision(shot.mesh.position, shot.kind === 'missile' ? .8 : .15); const expired = now - shot.born > (shot.kind === 'gun' ? 1200 : 5000);
    if (hit || expired) { if (shot.kind === 'missile') createExplosion(shot.mesh.position, hit ? .8 : .45); scene.remove(shot.mesh); projectiles.splice(i, 1); }
  }
}
function signalRef(peerId) { const key = [state.userId, peerId].sort().join('__'); return doc(state.db, 'lobbies', state.room, 'voiceSignals', key); }
function addLocalAudio(peer) { if (!localVoiceStream || peer.localTracksAdded) return; localVoiceStream.getTracks().forEach((track) => peer.connection.addTrack(track, localVoiceStream)); peer.localTracksAdded = true; }
function ensureVoicePeer(peerId) {
  let peer = voicePeers.get(peerId); if (peer) return peer;
  const connection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] });
  peer = { connection, offerCandidates: new Set(), answerCandidates: new Set(), remoteSet: false, localTracksAdded: false }; voicePeers.set(peerId, peer); addLocalAudio(peer);
  connection.ontrack = (event) => { const audio = new Audio(); audio.autoplay = true; audio.srcObject = event.streams[0]; audio.play().catch(() => {}); };
  connection.onicecandidate = (event) => { if (!event.candidate || !state.multiplayer) return; const offerer = state.userId < peerId; setDoc(signalRef(peerId), { offererId: offerer ? state.userId : peerId, answererId: offerer ? peerId : state.userId, [offerer ? 'offerCandidates' : 'answerCandidates']: arrayUnion(event.candidate.toJSON()), updatedAt: serverTimestamp() }, { merge: true }); };
  return peer;
}
async function startVoiceTransmit() {
  if (!gameStarted || !state.multiplayer || !state.team) return;
  try {
    if (!localVoiceStream) localVoiceStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    localVoiceStream.getAudioTracks().forEach((track) => { track.enabled = true; }); updateLocalPlayer({ voiceEnabled: true });
    state.players.forEach((player, id) => { if (id !== state.userId && player.status === 'active' && player.teamId === state.team.id && !voicePeers.has(id)) createVoiceOffer(id); });
  } catch (error) { console.error('Voice unavailable', error); toast('Mikrofon nicht verfügbar. Prüfe die Windows-Berechtigung.'); }
}
function stopVoiceTransmit() { localVoiceStream?.getAudioTracks().forEach((track) => { track.enabled = false; }); updateLocalPlayer({ voiceEnabled: false }); }
async function createVoiceOffer(peerId) {
  const peer = ensureVoicePeer(peerId); const offer = await peer.connection.createOffer(); await peer.connection.setLocalDescription(offer);
  await setDoc(signalRef(peerId), { offererId: state.userId, answererId: peerId, offer: { type: offer.type, sdp: offer.sdp }, offerCandidates: [], answerCandidates: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
}
async function processVoiceSignal(signal) {
  const data = signal.data(); if (!data.offererId || !data.answererId || (data.offererId !== state.userId && data.answererId !== state.userId)) return;
  const peerId = data.offererId === state.userId ? data.answererId : data.offererId; const peer = ensureVoicePeer(peerId);
  try {
    if (data.offer && data.answererId === state.userId && !peer.remoteSet) { await peer.connection.setRemoteDescription(new RTCSessionDescription(data.offer)); peer.remoteSet = true; const answer = await peer.connection.createAnswer(); await peer.connection.setLocalDescription(answer); await setDoc(signal.ref, { answer: { type: answer.type, sdp: answer.sdp }, updatedAt: serverTimestamp() }, { merge: true }); }
    if (data.answer && data.offererId === state.userId && !peer.remoteSet) { await peer.connection.setRemoteDescription(new RTCSessionDescription(data.answer)); peer.remoteSet = true; }
    const candidates = data.offererId === state.userId ? data.answerCandidates : data.offerCandidates; const seen = data.offererId === state.userId ? peer.answerCandidates : peer.offerCandidates;
    for (const candidate of candidates || []) { const key = candidate.candidate; if (!seen.has(key)) { seen.add(key); await peer.connection.addIceCandidate(new RTCIceCandidate(candidate)); } }
  } catch (error) { console.warn('Voice signalling failed', error); }
}
function startVoiceSignalling() { if (!state.multiplayer) return; unsubscribeVoiceSignals?.(); unsubscribeVoiceSignals = onSnapshot(collection(state.db, 'lobbies', state.room, 'voiceSignals'), (snapshot) => snapshot.docChanges().forEach((change) => { if (change.type !== 'removed') processVoiceSignal(change.doc); })); }
function addTerrain() {
  scene.fog = new THREE.Fog('#8fb2bd', 900, 4200); scene.background = new THREE.Color('#8fb2bd');
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 96, 96), new THREE.MeshStandardMaterial({ color: '#344f3b', roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow=true; scene.add(ground);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE, 260), new THREE.MeshPhysicalMaterial({ color: '#176270', metalness: .25, roughness: .12, transparent: true, opacity: .9 })); water.rotation.x = -Math.PI / 2; water.position.set(0, .08, 0); scene.add(water);
  const roadMat = new THREE.MeshStandardMaterial({ color: '#28332d', roughness: .95 }); for (const roadInfo of [[0, -640, 26, 1500], [-640, 0, 1500, 26], [640, 0, 1500, 26]]) { const road = new THREE.Mesh(new THREE.BoxGeometry(roadInfo[2], .06, roadInfo[3]), roadMat); road.position.set(roadInfo[0], .13, roadInfo[1]); scene.add(road); }
  const mountainMat = new THREE.MeshStandardMaterial({ color: '#425e50', roughness: .98 });
  for (let i = 0; i < 160; i += 1) {
    const angle = (i / 160) * Math.PI * 2; const radius = MAP_SIZE * .44 + (i % 5) * 32; const height = 45 + (i % 9) * 19; const width = 32 + (i % 6) * 18; const x = Math.cos(angle) * radius; const z = Math.sin(angle) * radius;
    const blocksTunnel = teams.some((team) => { const heading = Math.atan2(team.position[0], team.position[2]); const tunnelX = team.position[0] + Math.sin(heading) * -25; const tunnelZ = team.position[2] + Math.cos(heading) * -25; return Math.hypot(x - tunnelX, z - tunnelZ) < 82; });
    if (blocksTunnel) continue;
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(width, height, 7), mountainMat); mountain.position.set(x, height / 2 - 1, z); mountain.rotation.y = i; mountain.castShadow=true; scene.add(mountain); worldColliders.push({ x, z, radius: width * .72, height, type: 'mountain' });
  }
  const treeMat = new THREE.MeshStandardMaterial({ color: '#183d28', roughness: .9 }); for (let i = 0; i < 520; i += 1) { const x = -1650 + ((i * 197) % 3300); const z = -1650 + ((i * 353) % 3300); if (Math.abs(z) < 145 || Math.abs(x-Math.sign(x)*1120)<45 && Math.abs(z-Math.sign(z)*1120)<300) continue; const height = 8 + (i % 6) * 3; const tree = new THREE.Mesh(new THREE.ConeGeometry(3 + (i % 4), height, 7), treeMat); tree.position.set(x, height / 2, z); tree.castShadow=true; scene.add(tree); worldColliders.push({ x, z, radius: 2.2 + (i % 4), height, type: 'tree' }); }
  const cloudMat = new THREE.MeshBasicMaterial({color:'#f3f6ef',transparent:true,opacity:.42,depthWrite:false}); for(let i=0;i<24;i+=1){const cloud=new THREE.Group();for(let j=0;j<5;j+=1){const puff=new THREE.Mesh(new THREE.SphereGeometry(18+(j%3)*8,12,8),cloudMat);puff.position.set(j*22,Math.sin(j)*7,0);puff.scale.z=.55;cloud.add(puff);}cloud.position.set(-1500+(i*487)%3000,220+(i%5)*55,-1500+(i*733)%3000);scene.add(cloud);}
}
function beginGame() {
  if (gameStarted) return; gameStarted = true; scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(61, innerWidth / innerHeight, .08, 6000); scene.add(camera);
  renderer = new THREE.WebGLRenderer({ canvas: $('game-canvas'), antialias: true, powerPreference: 'high-performance' }); renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  scene.add(new THREE.HemisphereLight('#d9f6ff', '#17261d', 2.5)); const sun = new THREE.DirectionalLight('#fff1d6', 3.2); sun.position.set(100, 170, 60); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); scene.add(sun); addTerrain(); teams.forEach(makeBase);
  turret = null; tank = createVehicle(state.vehicle.id, state.team.id, true); tank.rotation.order = 'YXZ'; const runwayHeading = Math.atan2(state.team.position[0], state.team.position[2]); tank.rotation.y = runwayHeading; tank.position.set(state.team.position[0] + Math.sin(runwayHeading) * 205, state.vehicle.id === 'jet' ? 1.35 : state.vehicle.id === 'boat' ? 1 : 0, state.team.position[2] + Math.cos(runwayHeading) * 205); scene.add(tank);
  cockpitInterior = createCockpitInterior(); cockpitInterior.visible = false; camera.add(cockpitInterior);
  if (state.vehicle.id === 'jet') flight = { speed: 0, throttle: 0, pitch: 0, roll: 0, verticalSpeed: 0, airborne: false };
  $('hud-team').textContent = state.team.name; $('hud-team').style.color = state.team.color; $('match-room').textContent = `ONLINE · ${state.room}`; $('vehicle-name').textContent = state.vehicle.title;
  clock = new THREE.Clock(); window.addEventListener('resize', resize); document.addEventListener('keydown', (event) => { keys[event.code] = true; if (event.code === 'KeyC' && state.vehicle.id === 'jet') { cameraMode = cameraMode === 'third' ? 'cockpit' : 'third'; toast(cameraMode === 'cockpit' ? 'COCKPIT-ANSICHT' : 'AUSSENANSICHT'); } if (event.code === 'KeyV' && !event.repeat) startVoiceTransmit(); }); document.addEventListener('keyup', (event) => { keys[event.code] = false; if (event.code === 'KeyV') stopVoiceTransmit(); });
  $('game-canvas').addEventListener('click', () => $('game-canvas').requestPointerLock()); $('game-canvas').addEventListener('contextmenu', (event) => event.preventDefault()); $('game-canvas').addEventListener('mousedown', (event) => { if (document.pointerLockElement !== $('game-canvas')) return; if (event.button === 0) fireProjectile('gun'); if (event.button === 2) fireProjectile('missile'); }); document.addEventListener('mousemove', (event) => { if (turret && document.pointerLockElement === $('game-canvas')) turret.rotation.y -= event.movementX * .006; });
  syncRemotePlayers(); startVoiceSignalling(); syncLocalPlayer(true); animate(); toast(state.vehicle.id === 'jet' ? 'STARTFREIGABE: W gibt Schub, R zieht die Nase hoch.' : 'Online-Einsatz gestartet. Andere Spieler erscheinen automatisch auf der Karte.');
}
function syncLocalPlayer(force = false) {
  if (!state.multiplayer || !tank || (!force && performance.now() - state.lastSync < 100)) return; state.lastSync = performance.now();
  updateLocalPlayer({ status: 'active', teamId: state.team.id, vehicleId: state.vehicle.id, position: { x: Number(tank.position.x.toFixed(2)), y: Number(tank.position.y.toFixed(2)), z: Number(tank.position.z.toFixed(2)) }, rotationY: Number(tank.rotation.y.toFixed(4)), clientUpdatedAt: Date.now() });
}
function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); }
function animate() {
  requestAnimationFrame(animate); const delta = Math.min(clock.getDelta(), .05); let speed = 0;
  const previousPosition = tank.position.clone();
  if (!destroyed && state.vehicle.id === 'jet') {
    const pitchInput = (keys.KeyR || keys.ArrowUp ? 1 : 0) - (keys.KeyF || keys.ArrowDown ? 1 : 0); const rollInput = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0); const throttleInput = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    flight.throttle = THREE.MathUtils.clamp(flight.throttle + throttleInput * delta * .38, 0, 1); flight.speed = THREE.MathUtils.clamp(flight.speed + (flight.throttle * 12 - 1.8 - flight.speed * .08) * delta, 0, 120); flight.pitch = THREE.MathUtils.clamp(flight.pitch + pitchInput * delta * .34, -.28, .34); flight.roll = THREE.MathUtils.lerp(flight.roll, rollInput * .55, delta * 2.4);
    tank.rotation.x = flight.airborne ? flight.pitch : 0; tank.rotation.z = flight.roll; tank.rotation.y += rollInput * delta * (.2 + flight.speed * .008); tank.translateZ(-flight.speed * delta);
    if (flight.airborne) { const lift = Math.max(0, flight.speed - 32) * Math.max(0, flight.pitch + .08) * .72; flight.verticalSpeed += (lift - 9.81) * delta; tank.position.y += flight.verticalSpeed * delta; } else if (flight.speed > 42 && flight.pitch > .09) { flight.airborne = true; flight.verticalSpeed = 3.4; }
    if (tank.position.y <= 1) { const safeLanding = flight.airborne && isOnRunway(tank.position) && flight.verticalSpeed > -7 && Math.abs(flight.pitch) < .22 && Math.abs(flight.roll) < .3; if (flight.airborne && !safeLanding) destroyPlayer('JET ABGESTÜRZT'); tank.position.y = 1; flight.verticalSpeed = 0; flight.airborne = false; }
    speed = flight.speed; $('flight-status').textContent = flight.airborne ? `FLUG · ${Math.round(tank.position.y)} M` : `STARTLAUF · ${Math.round(flight.throttle * 100)}% SCHUB`;
  } else if (!destroyed) {
    let input = 0; if (keys.KeyW || keys.ArrowUp) input += 1; if (keys.KeyS || keys.ArrowDown) input -= 1; const steer = ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) - ((keys.KeyD || keys.ArrowRight) ? 1 : 0); const topSpeed = keys.ShiftLeft ? 33 : 19; if (input) tank.rotation.y += steer * delta * 1.35 * input; else if (steer) tank.rotation.y += steer * delta * .65; speed = input * topSpeed; tank.translateZ(-speed * delta); if (state.vehicle.id === 'boat') tank.position.y = 1 + Math.sin(performance.now() * .003) * .12; $('flight-status').textContent = 'BODENBETRIEB';
    if (state.vehicle.id !== 'boat' && tank.position.y > 0) { groundVelocity -= 18 * delta; tank.position.y = Math.max(0, tank.position.y + groundVelocity * delta); if (tank.position.y === 0) groundVelocity = 0; }
  }
  if (!destroyed) { const collision = findWorldCollision(tank.position, state.vehicle.id === 'jet' ? 4.5 : 3.6); if (collision) { if (Math.abs(speed) > 4 || state.vehicle.id === 'jet') destroyPlayer(`${collision.type === 'mountain' ? 'BERG' : 'HINDERNIS'}-KOLLISION`); else tank.position.copy(previousPosition); } }
  tank.position.x = THREE.MathUtils.clamp(tank.position.x, -MAP_SIZE / 2 + 40, MAP_SIZE / 2 - 40); tank.position.z = THREE.MathUtils.clamp(tank.position.z, -MAP_SIZE / 2 + 40, MAP_SIZE / 2 - 40);
  remotePlayers.forEach((remote) => { remote.object.position.lerp(remote.targetPosition, 1 - Math.pow(.001, delta)); const angle = Math.atan2(Math.sin(remote.targetRotation - remote.object.rotation.y), Math.cos(remote.targetRotation - remote.object.rotation.y)); remote.object.rotation.y += angle * Math.min(1, delta * 10); });
  if (state.vehicle.id === 'jet' && cameraMode === 'cockpit') { cockpitInterior.visible=true; const cockpit = tank.localToWorld(new THREE.Vector3(0, 1.85, -2.15)); const look = tank.localToWorld(new THREE.Vector3(0, 1.75, -60)); camera.position.lerp(cockpit, 1 - Math.pow(.0001, delta)); camera.lookAt(look); } else { cockpitInterior.visible=false; const desired = new THREE.Vector3(0, state.vehicle.id === 'jet' ? 11 : 15, state.vehicle.id === 'jet' ? 34 : 25).applyAxisAngle(new THREE.Vector3(0, 1, 0), tank.rotation.y).add(tank.position); camera.position.lerp(desired, 1 - Math.pow(.001, delta)); camera.lookAt(tank.position.x, tank.position.y + 2, tank.position.z); }
  updateProjectiles(delta); updateExplosions(delta); $('speed').textContent = `${Math.round(Math.abs(speed) * 3.6)} KM/H`; $('player-dot').style.left = `${50 + tank.position.x / MAP_SIZE * 100}%`; $('player-dot').style.top = `${50 + tank.position.z / MAP_SIZE * 100}%`; syncLocalPlayer(); renderer.render(scene, camera);
}

startFirebase();
