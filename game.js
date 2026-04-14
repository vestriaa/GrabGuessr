import * as THREE from 'three';
import { Controls } from './Controls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import * as SHADERS from 'https://grab-tools.live/js/shaders.js';
let PROTOBUF_DATA;
fetch('https://grab-tools.live/proto/proto.proto')
.then(d => d.text())
.then(text => {
    PROTOBUF_DATA = text;
})
.catch(e => {});
// import * as SHADERS from './shaders.js';
// import { PROTOBUF_DATA } from './protobuf.js';

const playerHeight = 1;

let camera, scene, renderer, light, sun, controls;

let startLocation = new THREE.Vector3(0, playerHeight, 0);
let objects = [];
let animatedObjects = [];
let loader = new GLTFLoader();
let clock = new THREE.Clock();
let isLoading = true;
let answer = undefined;
let answerJSON = undefined;
let score = 0;
let round = 0;
let difficulty = 500;
let hintsGiven = 0;
let sky;
let verifiedLevels, sortedLevels;
let textMaterial = new THREE.MeshBasicMaterial({color: 0xffffff});
let endLocation = new THREE.Vector3(0, playerHeight, 0);
let signLocations = [];
let time = 0;
let challengeSeed = null;
let challengePRNG = null;
let isMultiplayer = false;
let isHost = false;
let peer = null;
let hostConn = null;
let partyConnections = {};
let myName = "";
let partyLevels = [];
let partyCurrentRound = 0;
let partyPlayersGuessed = [];
let partyRoundState = "playing"; // "playing" or "over"

function mulberry32(a) {
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

const urlParams = new URLSearchParams(window.location.search);
let partyId = null;
if (urlParams.has('party')) {
    partyId = urlParams.get('party');
    isMultiplayer = true;
    isHost = false;
}
if (urlParams.has('challenge')) {
    challengeSeed = parseInt(urlParams.get('challenge'));
    challengePRNG = mulberry32(challengeSeed);
    let diff = urlParams.get('diff');
    if (diff) difficulty = isNaN(parseInt(diff)) ? diff : parseInt(diff);
}

let home = document.getElementById("home");
let materialList = [
    'textures/default.png',
    'textures/grabbable.png',
    'textures/ice.png',
    'textures/lava.png',
    'textures/wood.png',
    'textures/grapplable.png',
    'textures/grapplable_lava.png',
    'textures/grabbable_crumbling.png',
    'textures/default_colored.png',
    'textures/bouncing.png'
];
let shapeList = [
    'models/cube.gltf',
    'models/sphere.gltf',
    'models/cylinder.gltf',
    'models/pyramid.gltf',
    'models/prism.gltf',
    'models/cone.gltf',
    'models/sign.gltf',
    'models/start_end.gltf'
];

let sunAngle;
let sunAltitude;
let horizonColor;

let startMaterial, finishMaterial, skyMaterial, signMaterial, neonMaterial;
let materials = [];
let objectMaterials = [];
let shapes = [];

function loadTexture(path) {
    return new Promise((resolve) => {
        const texture = new THREE.TextureLoader().load(path, function (texture) {
            resolve(texture);
        });
    });
}

function loadModel(path) {
    return new Promise((resolve) => {
        loader.load(path, function (gltf) {
            const glftScene = gltf.scene;
            resolve(glftScene.children[0]);
        });
    });
}

async function initAttributes() {
    for (const path of materialList) {
        const texture = await loadTexture(path);
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        let material = new THREE.ShaderMaterial({
            vertexShader: SHADERS.levelVS,
            fragmentShader: SHADERS.levelFS,
            uniforms: {
                "colorTexture": { value: texture },
                "tileFactor": { value: 1.1 },
                "diffuseColor": { value: [1.0, 1.0, 1.0] },
                "worldNormalMatrix": { value: new THREE.Matrix3() },
                "neonEnabled": { value: 0.0 },
                "fogEnabled": { value: 1.0 },
                "specularColor": { value: [0.3, 0.3, 0.3, 16.0]}
            }
        });
        materials.push(material);
    }

    for (const path of shapeList) {
        const model = await loadModel(path);
        shapes.push(model);
    }

    startMaterial = new THREE.ShaderMaterial();
	startMaterial.vertexShader = SHADERS.startFinishVS;
	startMaterial.fragmentShader = SHADERS.startFinishFS;
	startMaterial.flatShading = true;
	startMaterial.transparent = true;
	startMaterial.depthWrite = false;
	startMaterial.uniforms = { "diffuseColor": {value: [0.0, 1.0, 0.0, 1.0]}};
	objectMaterials.push(startMaterial);

	finishMaterial = new THREE.ShaderMaterial();
	finishMaterial.vertexShader = SHADERS.startFinishVS;
	finishMaterial.fragmentShader = SHADERS.startFinishFS;
	finishMaterial.flatShading = true;
	finishMaterial.transparent = true;
	finishMaterial.depthWrite = false;
	finishMaterial.uniforms = { "diffuseColor": {value: [1.0, 0.0, 0.0, 1.0]}};
	objectMaterials.push(finishMaterial);
    
    skyMaterial = new THREE.ShaderMaterial();
    skyMaterial.vertexShader = SHADERS.skyVS;
    skyMaterial.fragmentShader = SHADERS.skyFS;
    skyMaterial.flatShading = false;
    skyMaterial.depthWrite = false;
    skyMaterial.side = THREE.BackSide;

    signMaterial = materials[4].clone();
    signMaterial.uniforms.colorTexture = materials[4].uniforms.colorTexture;
    signMaterial.vertexShader = SHADERS.signVS;
    signMaterial.fragmentShader = SHADERS.signFS;
    objectMaterials.push(signMaterial);
    
    neonMaterial = materials[8].clone();
    neonMaterial.uniforms.colorTexture = materials[8].uniforms.colorTexture;
    neonMaterial.uniforms.specularColor.value = [0.4, 0.4, 0.4, 64.0];
    neonMaterial.uniforms.neonEnabled.value = 1.0;
    objectMaterials.push(neonMaterial);

    sunAngle = new THREE.Euler(THREE.MathUtils.degToRad(45), THREE.MathUtils.degToRad(315), 0.0)
    sunAltitude = 45.0
    horizonColor = [0.916, 0.9574, 0.9574]
}

function readArrayBuffer(file) {
    return new Promise(function(resolve, reject) {
        let reader = new FileReader();
        reader.onload = function() {
            let data = reader.result;
            let {root} = protobuf.parse(PROTOBUF_DATA, { keepCase: true });
            console.log(root);
            let message = root.lookupType("COD.Level.Level");
            let decoded = message.decode(new Uint8Array(data));
            let object = message.toObject(decoded);
            resolve(object);
        }
        reader.onerror = function() {
            reject(reader);
        }
        reader.readAsArrayBuffer(file);
    });
}

async function openProto(link) {
    let response = await fetch(link);
    let data = await response.arrayBuffer();

    let blob = new Blob([data]);
    let level = await readArrayBuffer(blob);
    
    return level;
}

async function loadLeaderboard() {
    let leaderboard = document.getElementById("lbd");
    leaderboard.innerHTML = "Loading Leaderboard...";
    try {
        let fetchUrl = challengeSeed 
            ? `https://grabguessr.vestri.workers.dev/leaderboard?challenge=${challengeSeed}`
            : `https://grabguessr.vestri.workers.dev/leaderboard?difficulty=${difficulty}`;
        let res = await fetch(fetchUrl);
        let data = await res.json();
        leaderboard.innerHTML = challengeSeed ? "<h3>Challenge Leaderboard</h3>" : "<h3>Global Leaderboard</h3>";
        if (data.length === 0) {
            leaderboard.innerHTML += "<p>No scores yet. Be the first!</p>";
        } else {
            data.forEach((entry, i) => {
                leaderboard.innerHTML += `<p>${i + 1}. ${entry.name}: ${entry.score}</p>`;
            });
        }
    } catch (e) {
        leaderboard.innerHTML = "Failed to load leaderboard.";
    }
}

async function submitScore() {
    let name = document.getElementById("player-name").value;
    if (!name) return alert("Please enter a name!");
    
    document.getElementById("submit-btn").disabled = true;
    document.getElementById("submit-btn").innerText = "Submitting...";

    try {
        await fetch("https://grabguessr.vestri.workers.dev/leaderboard", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, score, difficulty, challenge: challengeSeed, token: gameToken })
        });
        document.getElementById("submit-score").style.display = "none";
        loadLeaderboard();
        score = 0; // Reset after successful submission
    } catch (e) {
        alert("Failed to submit score.");
    } finally {
        document.getElementById("submit-btn").disabled = false;
        document.getElementById("submit-btn").innerText = "Submit Score";
    }
}

document.getElementById("submit-btn").addEventListener("click", submitScore);

async function init() {
    
    console.log("Initializing");

    const verifiedLevelsData = await fetch("https://grab-tools.live/stats_data/all_verified.json");
    let initialLevels = await verifiedLevelsData.json();
    verifiedLevels = initialLevels.map(l => ({
        ...l,
        thumb: l.images?.thumb?.key
    }));
    sortedLevels = [...verifiedLevels].sort((a, b) => b?.statistics?.total_played - a?.statistics?.total_played);

    console.log("Loaded levels");

    THREE.ColorManagement.enabled = true;

    renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true});
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.setClearColor(new THREE.Color(143.0/255.0, 182.0/255.0, 221.0/255.0), 1.0);
    document.getElementById("viewport").appendChild( renderer.domElement );
    renderer.setPixelRatio(window.devicePixelRatio);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 10000 );
    camera.position.set( 0, playerHeight, 0 );
    light = new THREE.AmbientLight(0x404040);
    sun = new THREE.DirectionalLight( 0xffffff, 0.5 );
    controls = new Controls( camera, renderer.domElement );

    window.addEventListener( 'resize', onWindowResize );

    await initAttributes();
    isLoading = false;
    document.getElementById("loader").style.display = "none";
    document.getElementById("start-button").style.display = "block";
    document.getElementById("challenge-btn").style.display = "block";
    document.getElementById("party-btn").style.display = "block";

    if (partyId) {
        document.getElementById("main-menu-panel").style.display = "none";
        let lbdPanel = document.getElementById("leaderboard-panel");
        if (lbdPanel) lbdPanel.style.display = "none";
        document.getElementById("multiplayer-lobby-panel").style.display = "flex";
    }


    let startButton = document.getElementById("start");
    startButton.addEventListener( 'click', () => {
        home.style.display = "none";
        score = 0;
        gameToken = null;
        loadRandomLevel();
    } );

    setInterval(() => {
        if (time <= 5000) {
            if (partyRoundState !== "over") time++;
            displayBonus();
            
            if (isMultiplayer && window.partyTimeLimit > 0) {
                let timeRemaining = Math.max(window.partyTimeLimit - time, 0);
                document.getElementById("time").innerText = "Time Left: " + timeRemaining;
                if (isHost && timeRemaining === 0 && partyRoundState === "playing") {
                    checkAllGuessedForceFail();
                }
            } else {
                document.getElementById("time").innerText = "Time: " + time;
            }
        }
    }, 1000);

    animate();
}

async function loadRandomLevel() {
    if ( isLoading ) { return; }
    if (round == 10) {
        round = 0;
        displayRound();
        home.style.display = "flex";
        
        let currentHigh = parseInt(localStorage.getItem("GG-Score-" + difficulty) || "0");
        let newHigh = Math.max(score, currentHigh);
        localStorage.setItem("GG-Score-" + difficulty, newHigh);
        
        document.getElementById("submit-score").style.display = "flex";
        loadLeaderboard();
        
        return;
    }
    round++;
    time = 0;
    displayRound();
    let randomLevel;
    if (difficulty == "impossible") {
        let reqData = await fetch("https://grabguessr.vestri.workers.dev/get_random_level");
        let data = await reqData.json();
        randomLevel = data;
    } else {
        let randIdx;
        if (challengePRNG) {
            randIdx = Math.floor(challengePRNG() * Math.min(difficulty, sortedLevels.length - 1));
        } else {
            randIdx = Math.floor(Math.random() * Math.min(difficulty, sortedLevels.length - 1));
        }
        randomLevel = sortedLevels[randIdx];
        let reqData = await fetch(`https://grabguessr.vestri.workers.dev/details/${randomLevel.identifier.split(":").join("/")}`);
        let data = await reqData.json();
        randomLevel = data;
    }
    answer = randomLevel.identifier;
    answerJSON = randomLevel;
    hintsGiven = 0;
    hintButtons.forEach(button => {
        button.classList.remove("unlocked");
    });
    startHint.classList.add("unlocked");
    displayBonus();
    const downloadUrl = `https://grabguessr.vestri.workers.dev/download/${randomLevel.data_key.replace("level_data:", "").split(":").join("/")}`;
    const level =  await openProto(downloadUrl);
    await loadLevel(level);
}

let randomButton = document.getElementById("randomButton");

let gameToken = null;
async function logRound() {
    try {
        let res = await fetch("https://grabguessr.vestri.workers.dev/log_round", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ round: round, totalScore: score, previousToken: gameToken })
        });
        if (res.ok) {
            let data = await res.json();
            gameToken = data.token;
        } else {
            console.error("Anti-cheat blocked round log");
            gameToken = null;
        }
    } catch(e) {}
}

randomButton.addEventListener( 'click', async () => {
    if (isMultiplayer) {
         if (partyRoundState === "playing") guess("skip_invalid");
         return;
    }
    createPopup();
    displayScore();
    document.getElementById("loader").style.display = "block";
    await logRound();
    loadRandomLevel();
});

function displayScore() {
    document.getElementById("score").innerText = `Score: ${score}`;
}
function displayBonus() {
    document.getElementById("bonus").innerText = `+ ${Math.max(0, ((5 - hintsGiven) * 1000) - time)}`;
}
function displayRound() {
    document.getElementById("round").innerText = `Round: ${round}/${isMultiplayer ? partyLevels.length : 10}`;
}

async function guess(identifier) {
    if (isMultiplayer) {
        if (partyRoundState !== "playing" || window.localGuessLocked) return;
        window.localGuessLocked = true; // Local lock preventing multi-click spam sync leaks
        
        let exactMatch = (identifier == answer);
        let partialMatch = (!exactMatch && identifier.split(":")[0] == answer.split(":")[0]);
        
        if (exactMatch || partialMatch) {
            let pointsEarned = Math.max(0, ((5 - hintsGiven) * 1000) - time);
            
            score += pointsEarned;
            displayScore();
            
            if (isHost) {
                if (typeof multiplayerScores === 'undefined') window.multiplayerScores = {};
                multiplayerScores[peer.id] = (multiplayerScores[peer.id] || 0) + pointsEarned;
                
                if (window.partyGameMode === "score_attack") {
                     let ro = document.getElementById("round-overlay");
                     ro.style.display = "flex";
                     ro.style.backgroundColor = "rgba(46,204,113,0.8)";
                     document.getElementById("round-overlay-title").innerText = "Correct!";
                     document.getElementById("round-overlay-subtitle").innerText = `+${pointsEarned} Points. Waiting for others...`;
                     if (!partyPlayersGuessed.includes(peer.id)) partyPlayersGuessed.push(peer.id);
                     checkAllGuessed();
                } else {
                     partyRoundState = "over";
                     broadcastRoundWon(peer.id, myName);
                }
            } else {
                hostConn.send({ type: 'guess_correct', round: partyCurrentRound, points: pointsEarned });
                if (window.partyGameMode === "score_attack") {
                     let ro = document.getElementById("round-overlay");
                     ro.style.display = "flex";
                     ro.style.backgroundColor = "rgba(46,204,113,0.8)";
                     document.getElementById("round-overlay-title").innerText = "Correct!";
                     document.getElementById("round-overlay-subtitle").innerText = `+${pointsEarned} Points. Waiting for others...`;
                } else {
                     document.getElementById("loader").style.display = "block";
                }
            }
        } else {
            let ro = document.getElementById("round-overlay");
            ro.style.display = "flex";
            ro.style.backgroundColor = "rgba(200,0,0,0.8)";
            document.getElementById("round-overlay-title").innerText = "Wrong!";
            document.getElementById("round-overlay-subtitle").innerText = "Waiting for other players...";
            if (isHost) {
                if (!partyPlayersGuessed.includes(peer.id)) partyPlayersGuessed.push(peer.id);
                checkAllGuessed();
            } else {
                hostConn.send({ type: 'guess_wrong', round: partyCurrentRound });
            }
        }
        return;
    }

    if (identifier == answer) {
        score += Math.max(0, ((5 - hintsGiven) * 1000) - time);
    } else {
        if (identifier.split(":")[0] == answer.split(":")[0]) {
            score += Math.max(0, ((5 - hintsGiven) * 1000) - time);
        }
        createPopup();
    }
    displayScore();
    document.getElementById("loader").style.display = "block";
    await logRound();
    loadRandomLevel();
}

let difficultyButtons = document.querySelectorAll(".diff");
difficultyButtons.forEach(button => {
    button.addEventListener("click", () => {
        difficulty = parseInt(button.id);
        if (difficulty.toString() == "NaN") {
            difficulty = button.id;
        }
        difficultyButtons.forEach(b => {
            b.classList.remove("difficulty");
        });
        button.classList.add("difficulty");
        loadLeaderboard();
    });
});
document.querySelector(".difficulty").click();

const hintButtons = document.querySelectorAll(".hint");
hintButtons.forEach(button => {
    button.addEventListener("click", () => {
        if (!button.className.includes('unlocked')) {
            hintsGiven += 1;
            displayBonus();
            button.classList.add("unlocked");
        }
    });
});

const startHint = document.getElementById("start-hint");
const finishHint = document.getElementById("finish-hint");
const signHint = document.getElementById("sign-hint");
const fogHint = document.getElementById("fog-hint");
let signIter = 0;

startHint.addEventListener("click", () => {
    signIter = 0;
    camera.position.copy(startLocation);
});
finishHint.addEventListener("click", () => {
    signIter = 0;
    camera.position.copy(endLocation);
});
signHint.addEventListener("click", () => {
    camera.position.copy(signLocations[signIter]);
    camera.lookAt(signPositions[signIter]);
    signIter = (signIter + 1) % signLocations.length;
});
fogHint.addEventListener("click", () => {
    scene.traverse(function(node) {
		if(node instanceof THREE.Mesh && node?.geometry?.type != "TextGeometry") {
			if("material" in node && "fogEnabled" in node.material.uniforms) {
				node.material.uniforms["fogEnabled"].value = 0.0;
			}
		}
	})
});

async function loadSearch() {
    let query = document.getElementById("search").value;
    document.getElementById("cards").innerHTML = "";

    let results;
    if (difficulty == "impossible") {
        let searchRes = await fetch("https://grabguessr.vestri.workers.dev/list?max_format_version=100&type=search&search_term=" + query);
        let data = await searchRes.json();
        results = data;
    } else {
        let qCompact = query.toLowerCase().replaceAll(" ", "");
        results = verifiedLevels.filter(l => (
            l.title.toLowerCase().replaceAll(" ", "").includes(qCompact) ||
            (l?.creators || []).toString().toLowerCase().replaceAll(" ", "").includes(qCompact)
        ));
        if (query.charAt(0) == '"' && query.charAt(query.length - 1) == '"') {
            query = query.substring(1, query.length - 1);
            qCompact = query.toLowerCase().replaceAll(" ", "");
            results = verifiedLevels.filter(l => (
                l.title.toLowerCase().replaceAll(" ", "") == qCompact ||
                l.title.toLowerCase() == query.toLowerCase()
            ));
        }
    }
    
    if (results.length > 0) {
        for (let i = 0; i < Math.min(results.length, 100); i++) {
            let card = document.createElement("div");
            card.className = "card";
            let thumbnail = document.createElement("img");
            thumbnail.onerror = () => {
                thumbnail.style.display = "none";
            };
            thumbnail.src = "https://grab-images.slin.dev/" + (results[i]?.thumb || "");
            card.appendChild(thumbnail);
            let title = document.createElement("h3");
            title.innerText = results[i].title;
            title.className = "title";
            card.appendChild(title);
            let creators = document.createElement("p");
            creators.innerText = results[i].creators || "";
            creators.className = "creators";
            card.appendChild(creators);
            document.getElementById("cards").appendChild(card);
            card.addEventListener("click", async () => {
                guess(results[i].identifier);
            });
        }
    }
}
document.getElementById("search-submit").addEventListener("click", loadSearch);
document.getElementById("search").addEventListener("keypress", (e) => {
    if (e.key === "Enter") loadSearch();
});

document.getElementById("challenge-btn").addEventListener("click", () => {
    const seed = Math.floor(Math.random() * 1000000);
    const url = new URL(window.location.href);
    url.searchParams.set('challenge', seed);
    url.searchParams.set('diff', difficulty);
    navigator.clipboard.writeText(url.toString());
    alert("Challenge link copied to clipboard!\nShare this with friends to see who can guess these 10 maps fastest!");
});

async function loadLevel(level) {
    scene = new THREE.Scene();
    objects = [];
    animatedObjects = [];
    objects.push(controls.getObject());

    scene.add(light);
    scene.add(sun);
    scene.add(camera);
    
    let ambience = level.ambienceSettings;
    
    if (ambience) {
        if (ambience.skyHorizonColor) {
            ambience.skyHorizonColor?.r ? null : ambience.skyHorizonColor.r = 0;
            ambience.skyHorizonColor?.g ? null : ambience.skyHorizonColor.g = 0;
            ambience.skyHorizonColor?.b ? null : ambience.skyHorizonColor.b = 0;
        }
        if (ambience.skyZenithColor) {
            ambience.skyZenithColor?.r ? null : ambience.skyZenithColor.r = 0;
            ambience.skyZenithColor?.g ? null : ambience.skyZenithColor.g = 0;
            ambience.skyZenithColor?.b ? null : ambience.skyZenithColor.b = 0;
        }
        ambience.sunAltitude ? null : ambience.sunAltitude = 0;
        ambience.sunAzimuth ? null : ambience.sunAzimuth = 0;
        ambience.sunSize ? null : ambience.sunSize = 0;
        ambience.fogDDensity ? null : ambience.fogDDensity = 0;

        sunAngle = new THREE.Euler(THREE.MathUtils.degToRad(ambience.sunAltitude), THREE.MathUtils.degToRad(ambience.sunAzimuth), 0.0);

        skyMaterial.uniforms["cameraFogColor0"] = { value: [ambience.skyHorizonColor.r, ambience.skyHorizonColor.g, ambience.skyHorizonColor.b] }
        skyMaterial.uniforms["cameraFogColor1"] = { value: [ambience.skyZenithColor.r, ambience.skyZenithColor.g, ambience.skyZenithColor.b] }
        skyMaterial.uniforms["sunSize"] = { value: ambience.sunSize }

        sunAltitude = ambience.sunAltitude
        horizonColor = [ambience.skyHorizonColor.r, ambience.skyHorizonColor.g, ambience.skyHorizonColor.b]
    } else {
        skyMaterial.uniforms["cameraFogColor0"] = { value: [0.916, 0.9574, 0.9574] }
        skyMaterial.uniforms["cameraFogColor1"] = { value: [0.28, 0.476, 0.73] }
        skyMaterial.uniforms["sunSize"] = { value: 1.0 }
    }

    const sunDirection = new THREE.Vector3( 0, 0, 1 );
    sunDirection.applyEuler(sunAngle);

    const skySunDirection = sunDirection.clone()
    skySunDirection.x = skySunDirection.x;
    skySunDirection.y = skySunDirection.y;
    skySunDirection.z = skySunDirection.z;

    let sunColorFactor = 1.0 - sunAltitude / 90.0
    sunColorFactor *= sunColorFactor
    sunColorFactor = 1.0 - sunColorFactor
    sunColorFactor *= 0.8
    sunColorFactor += 0.2
    let sunColor = [horizonColor[0] * (1.0 - sunColorFactor) + sunColorFactor, horizonColor[1] * (1.0 - sunColorFactor) + sunColorFactor, horizonColor[2] * (1.0 - sunColorFactor) + sunColorFactor]

    skyMaterial.uniforms["sunDirection"] = { value: skySunDirection }
    skyMaterial.uniforms["sunColor"] = { value: sunColor }

    sky = new THREE.Mesh(shapes[1].geometry, skyMaterial);
    sky.frustumCulled = false
    sky.renderOrder = 1000 //sky should be rendered after opaque, before transparent
    scene.add(sky);
    console.log(sky);
    // document.body.style.backgroundImage = `linear-gradient(rgb(${sky[0][0]}, ${sky[0][1]}, ${sky[0][2]}), rgb(${sky[1][0]}, ${sky[1][1]}, ${sky[1][2]}), rgb(${sky[0][0]}, ${sky[0][1]}, ${sky[0][2]}))`;
    function updateMaterial(material) {
        let density = 0.0
        if(ambience)
        {
            material.uniforms["cameraFogColor0"] = { value: [ambience.skyHorizonColor.r, ambience.skyHorizonColor.g, ambience.skyHorizonColor.b] }
            material.uniforms["cameraFogColor1"] = { value: [ambience.skyZenithColor.r, ambience.skyZenithColor.g, ambience.skyZenithColor.b] }
            material.uniforms["sunSize"] = { value: ambience.sunSize }
            density = ambience.fogDDensity;
        }
        else
        {
            material.uniforms["cameraFogColor0"] = { value: [0.916, 0.9574, 0.9574] }
            material.uniforms["cameraFogColor1"] = { value: [0.28, 0.476, 0.73] }
            material.uniforms["sunSize"] = { value: 1.0 }
        }

        material.uniforms["sunDirection"] = { value: skySunDirection }
        material.uniforms["sunColor"] = { value: sunColor }

        let densityFactor = density * density * density * density
        let fogDensityX = 0.5 * densityFactor + 0.000001 * (1.0 - densityFactor)
        let fogDensityY = 1.0/(1.0 - Math.exp(-1500.0 * fogDensityX))

        material.uniforms["cameraFogDistance"] = { value: [fogDensityX, fogDensityY] }
			
    }
    
    for (let material of materials) {
        updateMaterial(material);
    }
    for (let material of objectMaterials) {
        updateMaterial(material);
    }

    level.levelNodes.forEach(node => {
        loadLevelNode(node, scene);
    });

    console.log(level);
    console.log(objects);
    console.log(scene);
    isLoading = false;
}

function createPopup() {
    if (!answerJSON) {
        return;
    }
    let lastPopup = document.getElementsByClassName("popup");
    if (lastPopup.length > 0) {
        lastPopup[0].remove();
    }
    console.log(answerJSON);
    let card = document.createElement("div");
    card.className = "card popup";
    let thumbnail = document.createElement("img");
    thumbnail.onerror = () => {
        thumbnail.style.display = "none";
    };
    thumbnail.src = "https://grab-images.slin.dev/" + (answerJSON?.thumb || "");
    card.appendChild(thumbnail);
    let title = document.createElement("h3");
    title.innerText = answerJSON.title;
    title.className = "title";
    card.appendChild(title);
    let creators = document.createElement("p");
    creators.innerText = answerJSON.creators || "";
    creators.className = "creators";
    card.appendChild(creators);
    document.body.appendChild(card);
    card.addEventListener("click", () => {
        card.remove();
    });
}

function loadLevelNode(node, parent) {
    let object = undefined;
    if (node.levelNodeGroup) {
        object = new THREE.Object3D();
        objects.push( object );
        parent.add( object );

        object.position.x = -node.levelNodeGroup.position?.x || 0;
        object.position.y = node.levelNodeGroup.position?.y || 0;
        object.position.z = -node.levelNodeGroup.position?.z || 0;
        object.scale.x = node.levelNodeGroup.scale?.x || 0;
        object.scale.y = node.levelNodeGroup.scale?.y || 0;
        object.scale.z = node.levelNodeGroup.scale?.z || 0;
        object.quaternion.x = -node.levelNodeGroup.rotation?.x || 0;
        object.quaternion.y = node.levelNodeGroup.rotation?.y || 0;
        object.quaternion.z = -node.levelNodeGroup.rotation?.z || 0;
        object.quaternion.w = node.levelNodeGroup.rotation?.w || 0;
        
        object.initialPosition = object.position.clone();
        object.initialRotation = object.quaternion.clone();
        
        node.levelNodeGroup.childNodes.forEach(node => {
            loadLevelNode(node, object);
        });
    } else if (node.levelNodeGravity) {

        let particleGeometry = new THREE.BufferGeometry();

        let particleColor = new THREE.Color(1.0, 1.0, 1.0);
        if (node.levelNodeGravity?.mode == 1) {
            particleColor = new THREE.Color(1.0, 0.6, 0.6);
        }
        let particleMaterial = new THREE.PointsMaterial({ color: particleColor, size: 0.05 });

        object = new THREE.Object3D()
        parent.add(object);

        object.position.x = -node.levelNodeGravity.position?.x || 0;
        object.position.y = node.levelNodeGravity.position?.y || 0;
        object.position.z = -node.levelNodeGravity.position?.z || 0;

        object.scale.x = node.levelNodeGravity.scale?.x || 0;
        object.scale.y = node.levelNodeGravity.scale?.y || 0;
        object.scale.z = node.levelNodeGravity.scale?.z || 0;

        object.quaternion.x = -node.levelNodeGravity.rotation?.x || 0;
        object.quaternion.y = node.levelNodeGravity.rotation?.y || 0;
        object.quaternion.z = -node.levelNodeGravity.rotation?.z || 0;
        object.quaternion.w = node.levelNodeGravity.rotation?.w || 0;

        object.initialPosition = object.position.clone();
        object.initialRotation = object.quaternion.clone();

        let particleCount = Math.floor(object.scale.x * object.scale.y * object.scale.z)
        particleCount = Math.min(particleCount, 2000);
        let particlePositions = [];

        for (let i = 0; i < particleCount; i++) {
            let x = (Math.random() - 0.5) * object.scale.x;
            let y = (Math.random() - 0.5) * object.scale.y;
            let z = (Math.random() - 0.5) * object.scale.z;

            particlePositions.push(x, y, z);
        }

        particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(particlePositions, 3));
        let particles = new THREE.Points(particleGeometry, particleMaterial);
        object.add(particles);
        objects.push(object);
    } else if (node.levelNodeStatic) { 
        // if (node.levelNodeStatic.shape-1000 >= 0 && node.levelNodeStatic.shape-1000 < shapes.length) {
        //     object = shapes[node.levelNodeStatic.shape-1000].clone();
        // } else {
        //     object = shapes[0].clone();
        // }
        let material = materials[0].clone();
        if (node.levelNodeStatic.material && node.levelNodeStatic.material >= 0 && node.levelNodeStatic.material < materials.length) {
            material = materials[node.levelNodeStatic.material].clone();
        }
        if (node.levelNodeStatic.material == 8) {
            if (node.levelNodeStatic.isNeon) {
                material = objectMaterials[3].clone();
            }
            node.levelNodeStatic.color1 ? null : node.levelNodeStatic.color1 = {};
            node.levelNodeStatic.color1.r ? null : node.levelNodeStatic.color1.r = 0;
            node.levelNodeStatic.color1.g ? null : node.levelNodeStatic.color1.g = 0;
            node.levelNodeStatic.color1.b ? null : node.levelNodeStatic.color1.b = 0;
            material.uniforms.diffuseColor.value = [node.levelNodeStatic.color1?.r, node.levelNodeStatic.color1?.g, node.levelNodeStatic.color1?.b]
            const specularFactor = Math.sqrt(node.levelNodeStatic.color1?.r * node.levelNodeStatic.color1?.r + node.levelNodeStatic.color1?.g * node.levelNodeStatic.color1?.g + node.levelNodeStatic.color1?.b * node.levelNodeStatic.color1?.b) * 0.15
            material.uniforms.specularColor.value = [specularFactor, specularFactor, specularFactor, 16.0]
        }
        object = new THREE.Mesh(shapes[node?.levelNodeStatic?.shape-1000 || 0].geometry, material);
        // object.material = material;
        parent.add(object);
        object.position.x = -node.levelNodeStatic.position?.x || 0;
        object.position.y = node.levelNodeStatic.position?.y || 0;
        object.position.z = -node.levelNodeStatic.position?.z || 0;
        object.quaternion.w = node.levelNodeStatic.rotation?.w || 0;
        object.quaternion.x = -node.levelNodeStatic.rotation?.x || 0;
        object.quaternion.y = node.levelNodeStatic.rotation?.y || 0;
        object.quaternion.z = -node.levelNodeStatic.rotation?.z || 0;
        object.scale.x = node.levelNodeStatic.scale?.x || 0;
        object.scale.y = node.levelNodeStatic.scale?.y || 0;
        object.scale.z = node.levelNodeStatic.scale?.z || 0;

        object.initialPosition = object.position.clone();
        object.initialRotation = object.quaternion.clone();

        let targetVector = new THREE.Vector3();
        let targetQuaternion = new THREE.Quaternion();
        let worldMatrix = new THREE.Matrix4();
        worldMatrix.compose(
            object.getWorldPosition(targetVector), 
            object.getWorldQuaternion(targetQuaternion), 
            object.getWorldScale(targetVector)
        );

        let normalMatrix = new THREE.Matrix3();
        normalMatrix.getNormalMatrix(worldMatrix);
        material.uniforms.worldNormalMatrix.value = normalMatrix;

        objects.push(object);

    } else if (node.levelNodeCrumbling) {
        let material;
        // if (node.levelNodeCrumbling.shape-1000 >= 0 && node.levelNodeCrumbling.shape-1000 < shapes.length) {
        //     object = shapes[node.levelNodeCrumbling.shape-1000].clone();
        // } else {
        //     object = shapes[0].clone();
        // }
        material = materials[7].clone();

        object = new THREE.Mesh(shapes[node?.levelNodeCrumbling?.shape-1000 || 0].geometry, material);
        // object.material = material;
        parent.add(object);
        object.position.x = -node.levelNodeCrumbling.position?.x || 0;
        object.position.y = node.levelNodeCrumbling.position?.y || 0;
        object.position.z = -node.levelNodeCrumbling.position?.z || 0;
        object.quaternion.w = node.levelNodeCrumbling.rotation?.w || 0;
        object.quaternion.x = -node.levelNodeCrumbling.rotation?.x || 0;
        object.quaternion.y = node.levelNodeCrumbling.rotation?.y || 0;
        object.quaternion.z = -node.levelNodeCrumbling.rotation?.z || 0;
        object.scale.x = node.levelNodeCrumbling.scale?.x || 0;
        object.scale.y = node.levelNodeCrumbling.scale?.y || 0;
        object.scale.z = node.levelNodeCrumbling.scale?.z || 0;

        object.initialPosition = object.position.clone();
        object.initialRotation = object.quaternion.clone();

        let targetVector = new THREE.Vector3();
        let targetQuaternion = new THREE.Quaternion();
        let worldMatrix = new THREE.Matrix4();
        worldMatrix.compose(
            object.getWorldPosition(targetVector), 
            object.getWorldQuaternion(targetQuaternion), 
            object.getWorldScale(targetVector)
        );

        let normalMatrix = new THREE.Matrix3();
        normalMatrix.getNormalMatrix(worldMatrix);
        material.uniforms.worldNormalMatrix.value = normalMatrix;

        objects.push(object);
        
    } else if (node.levelNodeSign) {
        // object = shapes[5].clone();
        // object.material = materials[4].clone();
        object = new THREE.Mesh(shapes[6].geometry, objectMaterials[2].clone());
        parent.add(object);
        object.position.x = -node.levelNodeSign.position?.x || 0;
        object.position.y = node.levelNodeSign.position?.y || 0;
        object.position.z = -node.levelNodeSign.position?.z || 0;
        object.quaternion.w = node.levelNodeSign.rotation?.w || 0;
        object.quaternion.x = -node.levelNodeSign.rotation?.x || 0;
        object.quaternion.y = node.levelNodeSign.rotation?.y || 0;
        object.quaternion.z = -node.levelNodeSign.rotation?.z || 0;

        const signText = node.levelNodeSign.text || "";
        const words = signText.split(" ");
        let text = "";
        for (let i = 0; i < words.length; i++) {
            if ((i + 1) % 3 == 0) {
                text += words[i] + "\n";
            } else {
                text += words[i] + " ";
            }
        }
        const fontLoader = new FontLoader();
        fontLoader.load( 'font.typeface.json', function ( response ) {

            let font = response;

            let textGeo = new TextGeometry( text, {
    
                font: font,
    
                size: 1,
                depth: -1,
                curveSegments: 4,
    
                bevelThickness: 0,
                bevelSize: 0,
                bevelEnabled: false
    
            } );
            textGeo.scale(-0.04, 0.04, 0.0000001);
            textGeo.computeBoundingBox();
            const centerOffsetX = 0.5 * ( textGeo.boundingBox.max.x - textGeo.boundingBox.min.x );
            const centerOffsetY = 0.5 * ( textGeo.boundingBox.max.y - textGeo.boundingBox.min.y );
            textGeo.translate( centerOffsetX, centerOffsetY, 0 );
            const textMesh = new THREE.Mesh( textGeo, textMaterial );
            textMesh.position.z = -0.2;

            const teleportObject = new THREE.Object3D();
            teleportObject.position.z = -1;
            object.add( teleportObject );
            let signLocation = teleportObject.getWorldPosition(new THREE.Vector3());
            signLocations.push(signLocation);
            signPositions.push(object.position.clone());

            object.add(textMesh);

        } );
        
        object.initialPosition = object.position.clone();
        object.initialRotation = object.quaternion.clone();
        
        objects.push(object);
    } else if (node.levelNodeStart) {
        // object = shapes[6].clone();
        // object.material = startMaterial;
        object = new THREE.Mesh(shapes[7].geometry, startMaterial);
        parent.add(object);
        object.position.x = -node.levelNodeStart.position?.x || 0;
        object.position.y = node.levelNodeStart.position?.y || 0;
        object.position.z = -node.levelNodeStart.position?.z || 0;
        object.quaternion.w = node.levelNodeStart.rotation?.w || 0;
        object.quaternion.x = -node.levelNodeStart.rotation?.x || 0;
        object.quaternion.y = node.levelNodeStart.rotation?.y || 0;
        object.quaternion.z = -node.levelNodeStart.rotation?.z || 0;
        object.scale.x = node.levelNodeStart.radius || 0;
        object.scale.z = node.levelNodeStart.radius || 0;

        object.initialPosition = object.position.clone();
        object.initialRotation = object.quaternion.clone();

        objects.push(object);
        startLocation.set(object.position.x, object.position.y + playerHeight, object.position.z);
        camera.position.copy(startLocation);

    } else if (node.levelNodeFinish) {
        // object = shapes[6].clone();
        // object.material = finishMaterial;
        object = new THREE.Mesh(shapes[7].geometry, finishMaterial);
        parent.add(object);
        object.position.x = -node.levelNodeFinish.position?.x || 0;
        object.position.y = node.levelNodeFinish.position?.y || 0;
        object.position.z = -node.levelNodeFinish.position?.z || 0;
        object.scale.x = node.levelNodeFinish.radius || 0;
        object.scale.z = node.levelNodeFinish.radius || 0;

        object.initialPosition = object.position.clone();
        object.initialRotation = object.quaternion.clone();

        objects.push(object);
        endLocation.set(object.position.x, object.position.y + playerHeight, object.position.z);
    }
    if (object !== undefined) {
        object.grabNodeData = node;
        if(node.animations && node.animations.length > 0 && node.animations[0].frames && node.animations[0].frames.length > 0) {
            for (let frame of node.animations[0].frames) {
                frame.position.x = frame.position?.x || 0;
                frame.position.y = frame.position?.y || 0;
                frame.position.z = frame.position?.z || 0;
                frame.rotation.x = frame.rotation?.x || 0;
                frame.rotation.y = frame.rotation?.y || 0;
                frame.rotation.z = frame.rotation?.z || 0;
                frame.rotation.w = frame.rotation?.w || 0;
                frame.time = frame.time || 0;
            }
            object.animation = node.animations[0]
            object.animation.currentFrameIndex = 0
            animatedObjects.push(object)
        }
    }
}

function updateObjectAnimation(object, time) {
	let animation = object.animation
	const animationFrames = animation.frames
	const relativeTime = (time * object.animation.speed) % animationFrames[animationFrames.length - 1].time;

    if (!animation.currentFrameIndex) {
        animation.currentFrameIndex = 0;
    }
	
	let oldFrame = animationFrames[animation.currentFrameIndex];
	let newFrameIndex = animation.currentFrameIndex + 1;
	if(newFrameIndex >= animationFrames.length) newFrameIndex = 0;
	let newFrame = animationFrames[newFrameIndex];

	let loopCounter = 0;
	while(loopCounter <= animationFrames.length)
	{
		oldFrame = animationFrames[animation.currentFrameIndex];
		newFrameIndex = animation.currentFrameIndex + 1;
		if(newFrameIndex >= animationFrames.length) newFrameIndex = 0;
		newFrame = animationFrames[newFrameIndex];
		
		if(oldFrame.time <= relativeTime && newFrame.time > relativeTime) break;
		animation.currentFrameIndex += 1;
		if(animation.currentFrameIndex >= animationFrames.length - 1) animation.currentFrameIndex = 0;
		
		loopCounter += 1;
	}

	let factor = 0.0
	let timeDiff = (newFrame.time - oldFrame.time);
	if(Math.abs(timeDiff) > 0.00000001)
	{
		factor = (relativeTime - oldFrame.time) / timeDiff;
	}

	const oldRotation = new THREE.Quaternion( oldFrame.rotation.x, oldFrame.rotation.y, oldFrame.rotation.z, oldFrame.rotation.w )
	const newRotation = new THREE.Quaternion( newFrame.rotation.x, newFrame.rotation.y, newFrame.rotation.z, newFrame.rotation.w )
	const finalRotation = new THREE.Quaternion()
	finalRotation.slerpQuaternions(oldRotation, newRotation, factor)

	const oldPosition = new THREE.Vector3( oldFrame.position.x, oldFrame.position.y, oldFrame.position.z )
	const newPosition = new THREE.Vector3( newFrame.position.x, newFrame.position.y, newFrame.position.z )
	const finalPosition = new THREE.Vector3()
	finalPosition.lerpVectors(oldPosition, newPosition, factor)

	object.position.copy(object.initialPosition).add(finalPosition.applyQuaternion(object.initialRotation))
	object.quaternion.multiplyQuaternions(object.initialRotation, finalRotation)
}

function animate() {
    requestAnimationFrame( animate );

    let delta = clock.getDelta();
    
    for(let object of animatedObjects) {
        updateObjectAnimation(object, delta);
    }

	renderer.render( scene, camera );
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    
    renderer.setSize( window.innerWidth, window.innerHeight );
}

// ====================
// MULTIPLAYER LOGIC
// ====================
document.getElementById("party-btn").addEventListener("click", () => {
    isMultiplayer = true;
    isHost = true;
    document.getElementById("main-menu-panel").style.display = "none";
    let lbdPanel = document.getElementById("leaderboard-panel");
    if (lbdPanel) lbdPanel.style.display = "none";
    document.getElementById("multiplayer-lobby-panel").style.display = "flex";
    document.getElementById("party-name-container").style.display = "flex";
});

document.getElementById("party-leave-btn").addEventListener("click", () => {
    window.location.href = window.location.pathname;
});

document.getElementById("party-join-btn").addEventListener("click", () => {
    myName = document.getElementById("party-name").value;
    if (!myName) {
        document.getElementById("party-name").style.border = "2px solid red";
        document.getElementById("party-name").placeholder = "Please enter a name";
        return;
    }
    document.getElementById("party-name").style.border = "none";
    
    document.getElementById("party-name-container").style.display = "none";
    document.getElementById("party-active-container").style.display = "flex";
    
    peer = new Peer();
    
    peer.on('open', (id) => {
        if (isHost) {
            document.getElementById("party-link-container").style.display = "flex";
            const url = new URL(window.location.href);
            url.searchParams.set('party', id);
            document.getElementById("party-link").value = url.toString();
            document.getElementById("party-start-btn").style.display = "block";
            document.getElementById("party-settings").style.display = "flex";
            updatePartyList([{ id: id, name: myName }]);
        } else {
            console.log("Connecting to host: " + partyId);
            hostConn = peer.connect(partyId, { metadata: { name: myName } });
            setupClientConnection(hostConn);
        }
    });

    if (isHost) {
        peer.on('connection', (conn) => {
            conn.on('open', () => {
                partyConnections[conn.peer] = { conn: conn, name: conn.metadata.name };
                if (typeof multiplayerScores !== 'undefined') multiplayerScores[conn.peer] = 0;
                broadcastPlayers();
                
                if (partyCurrentRound > 0 && partyCurrentRound <= partyLevels.length) {
                    conn.send({ type: 'start', levels: partyLevels, mode: window.partyGameMode });
                    if (partyRoundState === "playing") {
                        conn.send({ type: 'start_round', round: partyCurrentRound, levelData: partyLevels[partyCurrentRound-1] });
                    }
                }
            });
            conn.on('data', (data) => { handleHostData(conn.peer, data); });
            conn.on('close', () => { 
                delete partyConnections[conn.peer]; 
                if (partyPlayersGuessed.includes(conn.peer)) {
                    partyPlayersGuessed.splice(partyPlayersGuessed.indexOf(conn.peer), 1);
                }
                broadcastPlayers(); 
                checkAllGuessed();
            });
        });
    }
});

function broadcastPlayers() {
    const list = [{id: peer.id, name: myName}, ...Object.values(partyConnections).map(c => ({id: c.conn.peer, name: c.name}))];
    const data = { type: 'players', list };
    Object.values(partyConnections).forEach(c => c.conn.send(data));
    updatePartyList(list);
}

function updatePartyList(list) {
    if (typeof window.partyDisplayNames === 'undefined') window.partyDisplayNames = {};
    const ul = document.getElementById("party-players");
    ul.innerHTML = "";
    list.forEach(p => {
        window.partyDisplayNames[p.id] = p.name;
        ul.innerHTML += `<li>${p.name} ${p.id === peer?.id ? "(You)" : ""}</li>`;
    });
}

function setupClientConnection(conn) {
    conn.on('open', () => {
        console.log("Connected to host");
    });
    conn.on('close', () => {
        let ro = document.getElementById("round-overlay");
        ro.style.display = "flex";
        ro.style.backgroundColor = "rgba(0,0,0,0.8)";
        document.getElementById("round-overlay-title").innerText = "Disconnected";
        document.getElementById("round-overlay-subtitle").innerText = "The host left. Reloading game...";
        setTimeout(() => { window.location.href = window.location.pathname; }, 3000);
    });
    conn.on('data', (data) => {
        if (data.type === 'players') {
            updatePartyList(data.list);
        } else if (data.type === 'start') {
            window.partyGameMode = data.mode;
            partyLevels = data.levels;
            document.getElementById("multiplayer-lobby-panel").style.display = "none";
            startMultiplayerGame();
        } else if (data.type === 'start_round') {
            document.getElementById("round-overlay").style.display = "none";
            let popup = document.getElementsByClassName("popup");
            if(popup.length > 0) popup[0].remove();
            
            if (data.round) partyCurrentRound = data.round;
            partyLevels[partyCurrentRound-1] = data.levelData;
            
            partyPlayersGuessed = [];
            partyRoundState = "playing";
            window.localGuessLocked = false;
            time = 0;
            round = partyCurrentRound;
            displayRound();
            if (window.partyTimeLimit > 0) document.getElementById("time").innerText = "Time Left: " + window.partyTimeLimit;
            isLoading = true;
            document.getElementById("loader").style.display = "block";
            
            executeMultiplayerRound();
        } else if (data.type === 'round_won') {
            partyRoundState = "over";
            let ro = document.getElementById("round-overlay");
            ro.style.display = "flex";
            ro.style.backgroundColor = "rgba(46,204,113,0.8)";
            document.getElementById("round-overlay-title").innerText = "Round over!";
            document.getElementById("round-overlay-subtitle").innerText = `${data.winnerName} guessed it first!`;
            
            if (data.scores) populateRoundLeaderboard(data.scores);
            
            partyCurrentRound++;
            if (partyCurrentRound > partyLevels.length) {
                setTimeout(() => {
                    ro.style.display = "none";
                    showMultiplayerEnd(data.scores);
                }, 3000);
            } else {
                setTimeout(() => {
                    ro.style.display = "none";
                }, 4000); // Wait 4s to view leaderboard
            }
        } else if (data.type === 'round_over_all_wrong' || data.type === 'round_over_score_attack') {
            document.getElementById("round-overlay").style.display = "none";
            createPopup();
            
            partyCurrentRound++;
            
            // Show round-end overlay locally after popup for Score Attack logic!
            setTimeout(() => {
                 let ro = document.getElementById("round-overlay");
                 ro.style.display = "flex";
                 ro.style.backgroundColor = "rgba(0,0,0,0.5)";
                 let rob = document.getElementById("round-overlay-box");
                 if (rob) rob.style.borderColor = "rgba(255,255,255,0.2)";
                 document.getElementById("round-overlay-title").innerText = "Round Over!";
                 document.getElementById("round-overlay-subtitle").innerText = "Reviewing Standings...";
                 if (data.scores) populateRoundLeaderboard(data.scores);
                 
                 setTimeout(() => {
                     if (partyCurrentRound > partyLevels.length) {
                         let popup = document.getElementsByClassName("popup");
                         if (popup.length > 0) popup[0].remove();
                         ro.style.display = "none";
                         showMultiplayerEnd(data.scores);
                     } else {
                         ro.style.display = "none";
                     }
                 }, 4000);
            }, 3000); // Offset 3s so they can actually view the physical in-game text popup.
        } else if (data.type === 'game_over') {
            showMultiplayerEnd(data.scores);
        }
    });
}

document.getElementById("party-start-btn").addEventListener("click", () => {
    let pdiff = document.getElementById("party-settings-diff").value;
    let prounds = parseInt(document.getElementById("party-settings-rounds").value) || 10;
    window.partyTimeLimit = parseInt(document.getElementById("party-settings-time").value) || 0;
    window.partyGameMode = document.getElementById("party-settings-mode").value || "normal";
    
    let diff = pdiff === "impossible" ? 500 : parseInt(pdiff);
    partyLevels = [];
    for(let i=0; i<prounds; i++) {
        partyLevels.push(sortedLevels[Math.floor(Math.random() * Math.min(diff, sortedLevels.length - 1))]);
    }
    // ensure var exists if we clicked host
    if (typeof multiplayerScores === 'undefined') window.multiplayerScores = {};
    Object.keys(multiplayerScores).forEach(k => multiplayerScores[k] = 0);
    multiplayerScores[peer.id] = 0;
    
    Object.values(partyConnections).forEach(c => c.conn.send({ type: 'start', levels: partyLevels, mode: window.partyGameMode }));
    document.getElementById("multiplayer-lobby-panel").style.display = "none";
    startMultiplayerGame();
});

function startMultiplayerGame() {
    partyCurrentRound = 1;
    score = 0;
    loadMultiplayerRound();
}

async function loadMultiplayerRound() {
    if (isLoading) return;
    document.getElementById("home").style.display = "none";
    partyPlayersGuessed = [];
    partyRoundState = "playing";
    window.localGuessLocked = false;
    document.getElementById("round-overlay").style.display = "none";
    
    time = 0;
    round = partyCurrentRound;
    displayRound();
    isLoading = true;
    document.getElementById("loader").style.display = "block";
    
    if (isHost) {
        let randomLevel = partyLevels[partyCurrentRound-1];
        if (!randomLevel.data_key) {
            let reqData = await fetch(`https://grabguessr.vestri.workers.dev/details/${randomLevel.identifier.split(":").join("/")}`);
            randomLevel = await reqData.json();
            partyLevels[partyCurrentRound-1] = randomLevel;
        }
        
        Object.values(partyConnections).forEach(c => c.conn.send({ type: 'start_round', round: partyCurrentRound, levelData: randomLevel }));
        executeMultiplayerRound();
    }
}

async function executeMultiplayerRound() {
    let randomLevel = partyLevels[partyCurrentRound-1];
    answer = randomLevel.identifier;
    answerJSON = randomLevel;
    hintsGiven = 0;
    hintButtons.forEach(btn => btn.classList.remove("unlocked"));
    startHint.classList.add("unlocked");
    displayBonus();
    
    const downloadUrl = `https://grabguessr.vestri.workers.dev/download/${randomLevel.data_key.replace("level_data:", "").split(":").join("/")}`;
    let level = await openProto(downloadUrl);
    
    await loadLevel(level);
    isLoading = false;
    document.getElementById("loader").style.display = "none";
}

function handleHostData(peerId, data) {
    if (partyRoundState !== "playing") return;
    
    if (data.type === 'guess_correct') {
        if (data.round === partyCurrentRound) {
            multiplayerScores[peerId] = (multiplayerScores[peerId] || 0) + (data.points || 5000);
            
            if (window.partyGameMode === "score_attack") {
                if (!partyPlayersGuessed.includes(peerId)) partyPlayersGuessed.push(peerId);
                checkAllGuessed();
            } else {
                partyRoundState = "over";
                broadcastRoundWon(peerId, partyConnections[peerId].name);
            }
        }
    } else if (data.type === 'guess_wrong') {
        if (data.round === partyCurrentRound) {
            if (!partyPlayersGuessed.includes(peerId)) partyPlayersGuessed.push(peerId);
            checkAllGuessed();
        }
    }
}

function populateRoundLeaderboard(scores) {
    let container = document.getElementById("round-overlay-leaderboard");
    if (!container) {
        container = document.createElement("div");
        container.id = "round-overlay-leaderboard";
        container.style.marginTop = "25px";
        container.style.padding = "20px";
        container.style.background = "rgba(0,0,0,0.5)";
        container.style.borderRadius = "12px";
        container.style.border = "1px solid rgba(255,255,255,0.1)";
        container.style.color = "white";
        container.style.width = "100%";
        container.style.boxSizing = "border-box";
        let rob = document.getElementById("round-overlay-box");
        if (rob) rob.appendChild(container);
    }
    container.style.display = "block";
    container.innerHTML = "<h3 style='margin:0 0 15px 0; text-align:center; text-transform:uppercase; letter-spacing:1px; font-size:1.1rem; color:rgba(255,255,255,0.8); border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;'>Current Standings</h3>";
    
    let sorted = Object.entries(scores).map(([id, s]) => {
        let name = id === peer.id ? myName : (window.partyDisplayNames?.[id] || "Unknown");
        return { name, s };
    }).sort((a,b) => b.s - a.s);
    
    sorted.slice(0, 5).forEach((entry, i) => { // Top 5
        let rankColor = i === 0 ? "#FFD700" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : "rgba(255,255,255,0.5)";
        container.innerHTML += `<div style='margin:8px 0; padding:10px 15px; background:rgba(255,255,255,0.05); border-radius:6px; display:flex; justify-content:space-between; align-items: center; font-weight:500; font-size:1.1rem;'>
            <span style="display:flex; align-items:center; gap: 10px;">
                <span style="color: ${rankColor}; font-weight: bold; font-size: 1.2rem; width: 20px; text-align:center;">${i + 1}</span>
                <span style="color: rgba(255,255,255,0.9);">${entry.name}</span>
            </span>
            <span style="color:#4facfe; font-family: monospace; font-size: 1.2rem;">${entry.s}</span>
        </div>`;
    });
}

function checkAllGuessed() {
    if (partyRoundState !== "playing" && partyRoundState !== "over") return;
    let totalPlayers = Object.keys(partyConnections).length + 1;
    if (partyPlayersGuessed.length >= totalPlayers) {
        partyRoundState = "over";
        let s = { [peer.id]: multiplayerScores[peer.id] || 0 };
        Object.keys(partyConnections).forEach(k => { s[k] = multiplayerScores[k] || 0; });
        
        let typeStr = (window.partyGameMode === "score_attack") ? 'round_over_score_attack' : 'round_over_all_wrong';
        Object.values(partyConnections).forEach(c => c.conn.send({ type: typeStr, scores: s }));
        
        document.getElementById("round-overlay").style.display = "none";
        createPopup();
        
        setTimeout(() => {
             let ro = document.getElementById("round-overlay");
             ro.style.display = "flex";
             ro.style.backgroundColor = "rgba(0,0,0,0.8)";
             document.getElementById("round-overlay-title").innerText = "Round Over!";
             document.getElementById("round-overlay-subtitle").innerText = "Reviewing Standings...";
             populateRoundLeaderboard(s);
             
             setTimeout(() => {
                 partyCurrentRound++;
                 ro.style.display = "none";
                 if (partyCurrentRound <= partyLevels.length) loadMultiplayerRound();
                 else showMultiplayerEnd(s);
             }, 4000);
        }, 3000);
    }
}

function checkAllGuessedForceFail() {
    Object.keys(partyConnections).forEach(k => {
        if (!partyPlayersGuessed.includes(k)) partyPlayersGuessed.push(k);
    });
    if (!partyPlayersGuessed.includes(peer.id)) partyPlayersGuessed.push(peer.id);
    
    partyRoundState = "playing"; // Reset purely to trigger checkAllGuessed
    checkAllGuessed();
}

function broadcastRoundWon(winnerId, winnerName) {
    partyRoundState = "over";
    let s = { [peer.id]: multiplayerScores[peer.id] || 0 };
    Object.keys(partyConnections).forEach(k => { s[k] = multiplayerScores[k] || 0; });
    
    Object.values(partyConnections).forEach(c => c.conn.send({ type: 'round_won', winnerId, winnerName, scores: s }));
    
        let ro = document.getElementById("round-overlay");
        ro.style.display = "flex";
        ro.style.backgroundColor = "rgba(0,0,0,0.5)";
        let rob = document.getElementById("round-overlay-box");
        if (rob) rob.style.borderColor = "rgba(46,204,113,0.5)";
        document.getElementById("round-overlay-title").innerText = "Round over!";
    document.getElementById("round-overlay-subtitle").innerText = `${winnerName} guessed it first!`;
    
    populateRoundLeaderboard(s);
    
    partyCurrentRound++;
    setTimeout(() => {
        ro.style.display = "none";
        if (partyCurrentRound <= partyLevels.length) loadMultiplayerRound();
        else showMultiplayerEnd(s);
    }, 4000);
}

function showMultiplayerEnd(scores) {
    home.style.display = "flex";
    document.getElementById("main-menu-panel").style.display = "none";
    let lbdPanel = document.getElementById("leaderboard-panel");
    if (lbdPanel) lbdPanel.style.display = "none";
    document.getElementById("multiplayer-lobby-panel").style.display = "flex";
    
    if (isHost) {
        document.getElementById("party-start-btn").innerText = "Play Again";
        document.getElementById("party-start-btn").style.display = "block";
        document.getElementById("party-settings").style.display = "flex";
    }
    
    document.getElementById("submit-score").style.display = "none";
    
    let leaderboard = document.getElementById("lbd");
    leaderboard.innerHTML = "<h3>Party Leaderboard</h3>";
    
    let sorted = Object.entries(scores).map(([id, s]) => {
        let name = id === peer.id ? myName : (window.partyDisplayNames?.[id] || "Unknown");
        return { name, s };
    }).sort((a,b) => b.s - a.s);
    
    sorted.forEach((entry, i) => {
        leaderboard.innerHTML += `<p>${i + 1}. ${entry.name}: ${entry.s}</p>`;
    });
}

init();