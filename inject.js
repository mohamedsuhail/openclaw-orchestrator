import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dashboardPath = path.join(__dirname, 'src/ui/dashboard.html');
let html = fs.readFileSync(dashboardPath, 'utf8');

// 1. Inject Three.js
html = html.replace('</head>', `  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
</head>`);

// 2. Inject Simulation Container above goal-panel
const simulationHtml = `
    <section id="simulation-panel" style="width: 100%; height: 400px; position: relative; margin-bottom: 20px; border-radius: 12px; overflow: hidden; background: #fff;">
      <div id="simulation-container" style="width: 100%; height: 100%; position: absolute; inset: 0;"></div>
      <div id="html-labels-container" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: hidden;"></div>
    </section>
`;
html = html.replace('<section id="goal-panel">', simulationHtml + '\n    <section id="goal-panel">');

// 3. The OpenClawEngine JS logic
const engineJs = `

// --- OPENCLAW ENGINE ---
const LAYOUT = {
    'Thinking Room':  { x: 0, z: 0, color: 0xe0e7ff, label: 'Thinking Room' },
    'Web Servers':    { x: -22, z: -22, color: 0xcffafe, label: 'Web Servers' },
    'File Servers':   { x: 22, z: -22, color: 0xfef3c7, label: 'File Servers' },
    'Cron Scheduler': { x: 22, z: 22, color: 0xdcfce7, label: 'Cron Scheduler' },
    'Base':           { x: -22, z: 22, color: 0xf1f5f9, label: 'HQ Base' }
};

const AGENT_BASES = {
    'Health coach': { x: -28, z: 18 },
    'Devops':       { x: -22, z: 22 },
    'Marketsight':  { x: -16, z: 26 }
};

class OpenClawEngine {
    constructor(container, options = {}) {
        this.container = container;
        this.options = options;
        this.clock = new THREE.Clock();
        this.agents = {};
        this.props = [];
        this.animationFrameId = 0;
        this.mobotPulseCount = 0;

        const width = this.container.clientWidth || window.innerWidth || 1;
        const height = this.container.clientHeight || window.innerHeight || 1;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xffffff);

        const aspect = width / height;
        const frustumSize = 65;
        this.camera = new THREE.OrthographicCamera(
            frustumSize * aspect / -2, frustumSize * aspect / 2, 
            frustumSize / 2, frustumSize / -2, 1, 1000
        );
        this.camera.position.set(40, 40, 40);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        this.handleResize = this.handleResize.bind(this);
        window.addEventListener('resize', this.handleResize);

        this.initEnvironment();
        this.initAgents();
        
        this.animate = this.animate.bind(this);
        this.animate();
    }

    setAgentBusy(agentName, busy) {
        if (this.agents[agentName]) {
            this.agents[agentName].isBusy = busy;
            if (this.options.onAgentBusyStateChange) {
                this.options.onAgentBusyStateChange(agentName, busy);
            }
        }
    }

    handleResize() {
        if (!this.container) return;
        const width = this.container.clientWidth || window.innerWidth || 1;
        const height = this.container.clientHeight || window.innerHeight || 1;
        const aspect = width / height;
        const frustumSize = 65;
        this.camera.left = -frustumSize * aspect / 2;
        this.camera.right = frustumSize * aspect / 2;
        this.camera.top = frustumSize / 2;
        this.camera.bottom = -frustumSize / 2;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    initEnvironment() {
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc1d4e6, 0.7));
        const dirLight = new THREE.DirectionalLight(0xfff5e6, 0.8);
        dirLight.position.set(30, 50, 10);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        dirLight.shadow.camera.left = -40; dirLight.shadow.camera.right = 40;
        dirLight.shadow.camera.top = 40; dirLight.shadow.camera.bottom = -40;
        this.scene.add(dirLight);

        const floorSize = 80;
        
        const baseMat = new THREE.MeshStandardMaterial({ color: 0xfffbeb, roughness: 0.8 });
        const base = new THREE.Mesh(new THREE.BoxGeometry(floorSize, 4, floorSize), baseMat);
        base.position.set(0, -2, 0);
        base.receiveShadow = true;
        this.scene.add(base);

        const grid = new THREE.GridHelper(floorSize, 40, 0xfde68a, 0xfef3c7);
        grid.position.y = 0.01;
        this.scene.add(grid);

        const wallMat = new THREE.MeshStandardMaterial({ color: 0xe0f2fe, roughness: 1 });
        const wallHeight = 30;
        
        const wallZ = new THREE.Mesh(new THREE.PlaneGeometry(floorSize, wallHeight), wallMat);
        wallZ.position.set(0, wallHeight/2, -floorSize/2);
        wallZ.receiveShadow = true;
        this.scene.add(wallZ);

        const wallX = new THREE.Mesh(new THREE.PlaneGeometry(floorSize, wallHeight), wallMat);
        wallX.rotation.y = Math.PI / 2;
        wallX.position.set(-floorSize/2, wallHeight/2, 0);
        wallX.receiveShadow = true;
        this.scene.add(wallX);

        const windowFrame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 12, 20), new THREE.MeshStandardMaterial({ color: 0xffffff }));
        windowFrame.position.set(-floorSize/2 + 0.25, 15, -10);
        this.scene.add(windowFrame);
        const windowGlass = new THREE.Mesh(new THREE.PlaneGeometry(19, 11), new THREE.MeshBasicMaterial({ color: 0xbae6fd }));
        windowGlass.rotation.y = Math.PI / 2;
        windowGlass.position.set(-floorSize/2 + 0.6, 15, -10);
        this.scene.add(windowGlass);
        const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const cloud1 = new THREE.Mesh(new THREE.CircleGeometry(1.5, 16), cloudMat);
        cloud1.rotation.y = Math.PI / 2; cloud1.position.set(-floorSize/2 + 0.7, 16, -12); this.scene.add(cloud1);
        const cloud2 = new THREE.Mesh(new THREE.CircleGeometry(2, 16), cloudMat);
        cloud2.rotation.y = Math.PI / 2; cloud2.position.set(-floorSize/2 + 0.7, 15, -10); this.scene.add(cloud2);
        const cloud3 = new THREE.Mesh(new THREE.CircleGeometry(1.5, 16), cloudMat);
        cloud3.rotation.y = Math.PI / 2; cloud3.position.set(-floorSize/2 + 0.7, 14.5, -8); this.scene.add(cloud3);

        const board = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 0.5), new THREE.MeshStandardMaterial({ color: 0xffffff }));
        board.position.set(10, 14, -floorSize/2 + 0.25);
        board.castShadow = true;
        this.scene.add(board);
        const sticky1 = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ color: 0xfde047 }));
        sticky1.position.set(4, 15, -floorSize/2 + 0.51); this.scene.add(sticky1);
        const sticky2 = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ color: 0xf472b6 }));
        sticky2.position.set(7, 13, -floorSize/2 + 0.51); this.scene.add(sticky2);

        const buildRug = (x, z, color) => {
            const rug = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 0.2, 32), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
            rug.position.set(x, 0.1, z);
            rug.receiveShadow = true;
            this.scene.add(rug);
        };

        const createChunkyServer = (x, z, color) => {
            const group = new THREE.Group();
            group.position.set(x, 0, z);
            const body = new THREE.Mesh(new THREE.BoxGeometry(3, 4.5, 3), new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.1 }));
            body.position.y = 2.25;
            body.castShadow = true;
            group.add(body);
            const screen = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
            screen.position.set(0, 3.5, 1.5);
            group.add(screen);
            this.scene.add(group);
        };

        const createCuteDesk = (x, z, rotY) => {
            const group = new THREE.Group();
            group.position.set(x, 0, z);
            group.rotation.y = rotY;
            const top = new THREE.Mesh(new THREE.BoxGeometry(4, 0.4, 2.5), new THREE.MeshStandardMaterial({ color: 0xf8fafc }));
            top.position.set(0, 1.8, 0); top.castShadow = true; group.add(top);
            const legMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8 });
            const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.6, 2), legMat);
            leg1.position.set(-1.6, 0.8, 0); leg1.castShadow = true; group.add(leg1);
            const leg2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.6, 2), legMat);
            leg2.position.set(1.6, 0.8, 0); leg2.castShadow = true; group.add(leg2);
            const mon = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 0.4), new THREE.MeshStandardMaterial({ color: 0xffffff }));
            mon.position.set(0, 2.6, -0.5); mon.castShadow = true; group.add(mon);
            const screen = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.05), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
            screen.position.set(0, 0, 0.2); mon.add(screen);
            const chairMat = new THREE.MeshStandardMaterial({ color: 0xf43f5e });
            const seat = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.4), chairMat);
            seat.position.set(0, 1, 1); seat.castShadow = true; group.add(seat);
            const back = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 0.4), chairMat);
            back.position.set(0, 1.8, 1.5); back.castShadow = true; group.add(back);
            this.scene.add(group);
        };

        for (const r of Object.values(LAYOUT)) {
            buildRug(r.x, r.z, r.color);
        }

        const tX = LAYOUT['Thinking Room'].x; const tZ = LAYOUT['Thinking Room'].z;
        const table = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.4, 32), new THREE.MeshStandardMaterial({ color: 0xffffff }));
        table.position.set(tX, 1.4, tZ); table.castShadow = true; this.scene.add(table);
        const tLeg = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.2, 16), new THREE.MeshStandardMaterial({ color: 0x94a3b8 }));
        tLeg.position.set(tX, 0.6, tZ); tLeg.castShadow = true; this.scene.add(tLeg);
        
        const chairGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.6, 16);
        const chairMat = new THREE.MeshStandardMaterial({ color: 0x6366f1 });
        const angleStep = (Math.PI * 2) / 4;
        for(let i=0; i<4; i++) {
            const c = new THREE.Mesh(chairGeo, chairMat);
            c.position.set(tX + Math.cos(angleStep * i) * 4, 0.6, tZ + Math.sin(angleStep * i) * 4);
            c.castShadow = true; this.scene.add(c);
        }

        const wX = LAYOUT['Web Servers'].x; const wZ = LAYOUT['Web Servers'].z;
        createChunkyServer(wX - 2.5, wZ - 2, 0x0ea5e9);
        createChunkyServer(wX + 2.5, wZ - 2, 0x0ea5e9);

        const fX = LAYOUT['File Servers'].x; const fZ = LAYOUT['File Servers'].z;
        createChunkyServer(fX - 4, fZ - 2, 0xf59e0b);
        createChunkyServer(fX, fZ - 2, 0xf59e0b);
        createChunkyServer(fX + 4, fZ - 2, 0xf59e0b);

        const cX = LAYOUT['Cron Scheduler'].x; const cZ = LAYOUT['Cron Scheduler'].z;
        createChunkyServer(cX - 3, cZ - 2, 0x10b981);
        createChunkyServer(cX + 3, cZ - 2, 0x10b981);
        const clockCore = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 0.6, 32), new THREE.MeshStandardMaterial({ color: 0xffffff }));
        clockCore.rotation.x = Math.PI/2;
        clockCore.position.set(cX, 4, cZ - 2); this.scene.add(clockCore);
        const hand = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 0.2), new THREE.MeshBasicMaterial({ color: 0xf43f5e }));
        hand.position.set(cX, 4, cZ - 1.6); hand.geometry.translate(0, 0.6, 0);
        this.scene.add(hand); this.props.push({ mesh: hand, rotZ: -0.05 });

        const bX = LAYOUT['Base'].x; const bZ = LAYOUT['Base'].z;
        createCuteDesk(bX - 3, bZ - 3, 0);
        createCuteDesk(bX + 3, bZ - 3, 0);

        const pot = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.7, 1.5, 16), new THREE.MeshStandardMaterial({ color: 0xffffff }));
        pot.position.set(bX - 7, 0.75, bZ + 5); pot.castShadow = true;
        const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8, 1), new THREE.MeshStandardMaterial({ color: 0x22c55e, flatShading: true }));
        leaves.position.set(0, 2, 0); leaves.castShadow = true;
        pot.add(leaves);
        this.scene.add(pot);
    }

    initAgents() {
        this.createCuteCharacter('Mobot_V2', 'mobot', 0x8b5cf6, 0, 0); 
        this.createCuteCharacter('Health coach', 'health', 0x22c55e, AGENT_BASES['Health coach'].x, AGENT_BASES['Health coach'].z);
        this.createCuteCharacter('Devops', 'devops', 0x3b82f6, AGENT_BASES['Devops'].x, AGENT_BASES['Devops'].z);
        this.createCuteCharacter('Marketsight', 'market', 0xf97316, AGENT_BASES['Marketsight'].x, AGENT_BASES['Marketsight'].z);
    }

    createCuteCharacter(name, type, color, startX, startZ) {
        const group = new THREE.Group();
        group.position.set(startX, 0, startZ);
        
        const skinMat = new THREE.MeshStandardMaterial({ color: 0xffd1b3, roughness: 0.6 });
        const shirtMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.8 });
        const pantsMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 });
        const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });

        const legs = new THREE.Group();
        const legMat = type === 'mobot' ? shirtMat : pantsMat;
        const legL = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.8), legMat); 
        legL.position.set(-0.5, 0.6, 0);
        const legR = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.8), legMat); 
        legR.position.set(0.5, 0.6, 0);
        legs.add(legL); legs.add(legR);

        let bodyMat = shirtMat;
        if (type === 'health') bodyMat = whiteMat;
        
        const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.0, 1.4), bodyMat);
        body.position.y = 2.2;

        const head = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, 2.6), skinMat);
        head.position.y = 4.5;

        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
        const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), eyeMat);
        eyeL.position.set(-0.6, 0.2, 1.3); head.add(eyeL);
        const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), eyeMat);
        eyeR.position.set(0.6, 0.2, 1.3); head.add(eyeR);

        const armL = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.5, 0.6), bodyMat); 
        armL.position.set(-1.4, 2.2, 0);
        const armR = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.5, 0.6), bodyMat); 
        armR.position.set(1.4, 2.2, 0);
        group.add(armL); group.add(armR);
        
        if (type === 'mobot') {
            head.material = shirtMat;
            const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1), new THREE.MeshStandardMaterial({color: 0x64748b}));
            ant.position.set(0, 1.6, 0);
            const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3), new THREE.MeshBasicMaterial({color: 0xe879f9}));
            bulb.position.set(0, 0.6, 0); ant.add(bulb);
            head.add(ant);
        } else if (type === 'health') {
            const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.0, 0.2), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
            const hBar = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.3, 0.2), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
            vBar.position.set(0, 0, 0.75); hBar.position.set(0, 0, 0.75);
            body.add(vBar); body.add(hBar);
        } else if (type === 'devops') {
            const glassFrame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 0.2), new THREE.MeshBasicMaterial({ color: 0x1e293b }));
            glassFrame.position.set(0, 0.2, 1.35);
            const lens1 = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), new THREE.MeshBasicMaterial({ color: 0xbae6fd }));
            lens1.position.set(-0.5, 0, 0.11); glassFrame.add(lens1);
            const lens2 = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), new THREE.MeshBasicMaterial({ color: 0xbae6fd }));
            lens2.position.set(0.5, 0, 0.11); glassFrame.add(lens2);
            head.add(glassFrame);
        } else if (type === 'market') {
            const chartMat = new THREE.MeshBasicMaterial({color: 0x22c55e});
            const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.2), chartMat); b1.position.set(-0.4, -0.2, 0.75); body.add(b1);
            const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.2), chartMat); b2.position.set(0, 0, 0.75); body.add(b2);
            const b3 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 0.2), chartMat); b3.position.set(0.4, 0.2, 0.75); body.add(b3);
        }
        
        group.add(legs); group.add(body); group.add(head);
        group.traverse(child => { if (child.isMesh) child.castShadow = true; });
        this.scene.add(group);

        this.agents[name] = { group, body, head, legs, baseY: 0, color, isBusy: false };
    }

    delay(ms) {
        return new Promise(res => setTimeout(res, ms));
    }

    walkTo(agentName, targetX, targetZ) {
        return new Promise(resolve => {
            const agent = this.agents[agentName];
            const startX = agent.group.position.x;
            const startZ = agent.group.position.z;
            
            const dist = Math.sqrt(Math.pow(targetX - startX, 2) + Math.pow(targetZ - startZ, 2));
            const duration = dist * 50; 

            const angle = Math.atan2(targetX - startX, targetZ - startZ);
            agent.group.rotation.y = angle;

            const startTime = performance.now();
            const animateStep = (time) => {
                const elapsed = time - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                agent.group.position.x = THREE.MathUtils.lerp(startX, targetX, progress);
                agent.group.position.z = THREE.MathUtils.lerp(startZ, targetZ, progress);
                
                const bobHeight = 0.5;
                const bobFreq = 10;
                
                agent.body.position.y = agent.baseY + 2.2 + Math.abs(Math.sin(progress * Math.PI * bobFreq)) * bobHeight;
                agent.head.position.y = agent.body.position.y + 2.3;
                
                agent.legs.children[0].rotation.x = Math.sin(progress * Math.PI * bobFreq) * 0.8;
                agent.legs.children[1].rotation.x = -Math.sin(progress * Math.PI * bobFreq) * 0.8;

                if (progress < 1) {
                    requestAnimationFrame(animateStep);
                } else {
                    agent.body.position.y = agent.baseY + 2.2;
                    agent.head.position.y = agent.body.position.y + 2.3;
                    agent.legs.children[0].rotation.x = 0;
                    agent.legs.children[1].rotation.x = 0;
                    resolve();
                }
            };
            requestAnimationFrame(animateStep);
        });
    }

    transferData(agentName, toX, toY, toZ, hexColor) {
        return new Promise(resolve => {
            const agent = this.agents[agentName];
            const start = new THREE.Vector3(agent.group.position.x, 4, agent.group.position.z);
            const end = new THREE.Vector3(toX, toY, toZ);
            
            const tempPacket = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), new THREE.MeshBasicMaterial({ color: hexColor }));
            tempPacket.position.copy(start);
            this.scene.add(tempPacket);

            let progress = 0;
            const animateTransfer = () => {
                progress += 0.04; 
                if(progress >= 1) {
                    this.scene.remove(tempPacket);
                    tempPacket.geometry.dispose();
                    tempPacket.material.dispose();
                    resolve();
                    return;
                }
                
                const currentPos = new THREE.Vector3().lerpVectors(start, end, progress);
                currentPos.y += Math.sin(progress * Math.PI) * 4; 
                tempPacket.position.copy(currentPos);
                
                requestAnimationFrame(animateTransfer);
            }
            animateTransfer();
        });
    }

    pulseMobot(active) {
        const ant = this.agents['Mobot_V2'].head.children.find(c => c.geometry.type === 'CylinderGeometry');
        if (!ant) return;
        const bulb = ant.children[0];
        if (!bulb) return;

        const mat = bulb.material;
        
        if(active) {
            this.mobotPulseCount++;
            mat.color.setHex(0xffffff);
            mat.needsUpdate = true;
        } else {
            this.mobotPulseCount = Math.max(0, this.mobotPulseCount - 1);
            if(this.mobotPulseCount === 0) {
                mat.color.setHex(0xe879f9); 
                mat.needsUpdate = true;
            }
        }
    }

    async dispatchTask(agentName) {
        if (!this.agents[agentName]) {
            console.warn("Agent " + agentName + " not found in simulation.");
            return;
        }
        if (this.agents[agentName].isBusy) return;

        this.setAgentBusy(agentName, true);
        
        const rX = () => (Math.random() * 4) - 2;
        const rZ = () => (Math.random() * 4) - 2;
        
        this.pulseMobot(true);
        await this.delay(300);
        
        await this.walkTo(agentName, LAYOUT['Thinking Room'].x + rX(), LAYOUT['Thinking Room'].z + 5 + rZ());
        await this.transferData('Mobot_V2', this.agents[agentName].group.position.x, 4, this.agents[agentName].group.position.z, this.agents['Mobot_V2'].color);
        this.pulseMobot(false);
        
        await this.walkTo(agentName, LAYOUT['Web Servers'].x + 5 + rX(), LAYOUT['Web Servers'].z + 5 + rZ());
        await this.transferData(agentName, LAYOUT['Web Servers'].x, 2.2, LAYOUT['Web Servers'].z, this.agents[agentName].color);
        await this.delay(800);
        
        await this.walkTo(agentName, LAYOUT['File Servers'].x - 5 + rX(), LAYOUT['File Servers'].z + 5 + rZ());
        await this.transferData(agentName, LAYOUT['File Servers'].x, 3, LAYOUT['File Servers'].z, this.agents[agentName].color);
        await this.delay(600);
        
        await this.walkTo(agentName, LAYOUT['Cron Scheduler'].x - 5 + rX(), LAYOUT['Cron Scheduler'].z - 5 + rZ());
        await this.transferData(agentName, LAYOUT['Cron Scheduler'].x, 4, LAYOUT['Cron Scheduler'].z, this.agents[agentName].color);
        await this.delay(600);

        await this.walkTo(agentName, AGENT_BASES[agentName].x, AGENT_BASES[agentName].z);
        this.agents[agentName].group.rotation.y = 0; 
        
        this.setAgentBusy(agentName, false);
    }

    getScreenPosition(worldPosition) {
        const width = this.container.clientWidth || window.innerWidth || 1;
        const height = this.container.clientHeight || window.innerHeight || 1;
        const tempV = worldPosition.clone();
        tempV.project(this.camera);
        const x = (tempV.x * .5 + .5) * width;
        const y = (tempV.y * -.5 + .5) * height;
        return { x: isNaN(x) ? 0 : x, y: isNaN(y) ? 0 : y };
    }

    getAgentPositions() {
        const pos = {};
        for(let key in this.agents) {
            pos[key] = new THREE.Vector3(this.agents[key].group.position.x, this.agents[key].group.position.y + 6, this.agents[key].group.position.z);
        }
        return pos;
    }

    getRoomPositions() {
        const pos = {};
        for(let key in LAYOUT) {
            pos[key] = {
                pos: new THREE.Vector3(LAYOUT[key].x, 0, LAYOUT[key].z),
                label: LAYOUT[key].label
            };
        }
        return pos;
    }

    animate() {
        this.animationFrameId = requestAnimationFrame(this.animate);
        this.props.forEach(p => {
            if(p.rotY) p.mesh.rotation.y += p.rotY;
            if(p.rotZ) p.mesh.rotation.z += p.rotZ;
        });
        this.renderer.render(this.scene, this.camera);
    }

    destroy() {
        cancelAnimationFrame(this.animationFrameId);
        window.removeEventListener('resize', this.handleResize);
        this.renderer.dispose();
        this.container.innerHTML = '';
    }
}

// Global engine instance
var engine = null;

function initSimulation() {
    var container = document.getElementById("simulation-container");
    if (!container) return;
    
    // Wait for THREE.js to load just in case
    if (typeof THREE === "undefined") {
        setTimeout(initSimulation, 100);
        return;
    }

    engine = new OpenClawEngine(container);

    // Update HTML Labels
    var labelsContainer = document.getElementById("html-labels-container");
    function updateLabels() {
        if (!engine) return;
        
        var htmlContent = "";
        
        // Rooms
        var rooms = engine.getRoomPositions();
        for (var k in rooms) {
            var room = rooms[k];
            var p = engine.getScreenPosition(room.pos);
            htmlContent += "<div style='position:absolute; transform: translate(-50%, -50%); color:#64748b; font-weight:bold; font-size:10px; text-transform:uppercase; letter-spacing:1px; left:" + p.x + "px; top:" + p.y + "px;'>" + room.label + "</div>";
        }

        // Agents
        var agents = engine.getAgentPositions();
        for (var a in agents) {
            var aPos = engine.getScreenPosition(agents[a]);
            htmlContent += "<div style='position:absolute; transform: translate(-50%, -100%); background:white; color:#1e293b; padding:4px 8px; border-radius:12px; font-weight:bold; font-size:10px; box-shadow:0 2px 4px rgba(0,0,0,0.1); border:2px solid #f1f5f9; left:" + aPos.x + "px; top:" + aPos.y + "px;'>" + a + "</div>";
        }

        labelsContainer.innerHTML = htmlContent;

        requestAnimationFrame(updateLabels);
    }
    updateLabels();
}

// Start simulation on load
window.addEventListener("DOMContentLoaded", initSimulation);
`;

html = html.replace('connectSSE();', engineJs + '\n    connectSSE();');

// 4. Hook up the dispatch logic inside task:started
const hookStr = `
        case "task:started":
          updateTaskStatus(event.stepNumber, event.taskId, "running");
          if (engine && stepsData[event.stepNumber] && stepsData[event.stepNumber].tasks[event.taskId]) {
            var agName = stepsData[event.stepNumber].tasks[event.taskId].agent;
            if (agName && typeof engine.dispatchTask === "function") {
                // Ignore API/system agents, only animate known ones
                if (agName === "Health coach" || agName === "Devops" || agName === "Marketsight") {
                    engine.dispatchTask(agName).catch(function(e) { console.error(e); });
                }
            }
          }
          break;
`;
html = html.replace('case "task:started":\n          updateTaskStatus(event.stepNumber, event.taskId, "running");\n          break;', hookStr);

fs.writeFileSync(dashboardPath, html);
console.log('Successfully injected simulation code.');