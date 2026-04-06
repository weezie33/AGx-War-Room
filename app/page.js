"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  setDoc,
  deleteDoc,
} from "firebase/firestore";

const HEX_SIZE = 24;
const SQRT3 = Math.sqrt(3);
const GRID_COLS = 35;
const GRID_ROWS = 35;
const ACTIVE_CURSOR_MS = 15000;

const BOARD_IDS = ["canyon", "defense", "offense", "reserve"];
const TOOLS = [
  { id: "select", label: "Select" },
  { id: "player", label: "Player" },
  { id: "hq", label: "HQ (7)" },
  { id: "refinery", label: "Refinery" },
  { id: "medical", label: "Medical Tent" },
  { id: "military", label: "Military Base" },
  { id: "mine", label: "Mine" },
  { id: "boss", label: "Boss" },
  { id: "label", label: "Ground Label" },
  { id: "note", label: "Ground Note" },
  { id: "arrow", label: "Arrow" },
  { id: "delete", label: "Delete Tool" },
];

const MUD_ROW = [
  { position: 1, X: 518, Y: 535 },
  { position: 2, X: 519, Y: 534 },
  { position: 3, X: 519, Y: 533 },
  { position: 4, X: 520, Y: 532 },
  { position: 5, X: 520, Y: 531 },
  { position: 6, X: 521, Y: 530 },
  { position: 7, X: 521, Y: 529 },
  { position: 8, X: 522, Y: 528 },
  { position: 9, X: 522, Y: 527 },
  { position: 10, X: 523, Y: 526 },
  { position: 11, X: 523, Y: 525 },
  { position: 12, X: 524, Y: 524 },
  { position: 13, X: 524, Y: 523 },
  { position: 14, X: 525, Y: 522 },
  { position: 15, X: 525, Y: 521 },
  { position: 16, X: 526, Y: 520 },
  { position: 17, X: 526, Y: 519 },
  { position: 18, X: 527, Y: 518 },
  { position: 19, X: 527, Y: 517 },
  { position: 20, X: 528, Y: 516 },
  { position: 21, X: 528, Y: 515 },
  { position: 22, X: 529, Y: 514 },
  { position: 23, X: 529, Y: 513 },
  { position: 24, X: 530, Y: 512 },
  { position: 25, X: 530, Y: 511 },
  { position: 26, X: 531, Y: 510 },
  { position: 27, X: 531, Y: 509 },
  { position: 28, X: 532, Y: 508 },
  { position: 29, X: 532, Y: 507 },
  { position: 30, X: 533, Y: 506 },
  { position: 31, X: 533, Y: 505 },
  { position: 32, X: 534, Y: 504 },
  { position: 33, X: 534, Y: 503 },
  { position: 34, X: 535, Y: 502 },
  { position: 35, X: 535, Y: 501 },
];

// user-verified anchor: five hexes inward from position 1 lands at X:520 Y:539
const INWARD_VECTOR = {
  xPerStep: (520 - 518) / 5,
  yPerStep: (539 - 535) / 5,
};

function makeId(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getClientId() {
  if (typeof window === "undefined") return "client-server";
  const key = "lastz-war-room-client-id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const fresh = makeId("client");
  window.localStorage.setItem(key, fresh);
  return fresh;
}

function getFirebase() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  const ready = Object.values(config).every(Boolean);
  if (!ready) return null;
  const app = getApps()[0] || initializeApp(config);
  return getFirestore(app);
}

function axialToPixel(q, r, size = HEX_SIZE) {
  return {
    x: size * SQRT3 * (q + r / 2),
    y: size * 1.5 * r,
  };
}

function pixelToAxial(x, y, size = HEX_SIZE) {
  const q = ((SQRT3 / 3) * x - y / 3) / size;
  const r = ((2 / 3) * y) / size;
  return hexRound(q, -q - r, r);
}

function hexRound(q, s, r) {
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);
  const qDiff = Math.abs(rq - q);
  const rDiff = Math.abs(rr - r);
  const sDiff = Math.abs(rs - s);
  if (qDiff > rDiff && qDiff > sDiff) rq = -rr - rs;
  else if (rDiff > sDiff) rr = -rq - rs;
  else rs = -rq - rr;
  return { q: rq, r: rr };
}

function hexPoints(cx, cy, size = HEX_SIZE) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((60 * i - 30) * Math.PI) / 180;
    pts.push(`${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`);
  }
  return pts.join(" ");
}

function buildCells() {
  const cells = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let q = 0; q < GRID_COLS; q++) {
      const p = axialToPixel(q, r);
      const server = serverCoordFor(q, r);
      cells.push({ q, r, x: p.x, y: p.y, serverX: server.X, serverY: server.Y });
    }
  }
  return cells;
}

function serverCoordFor(q, r) {
  const base = MUD_ROW[q] || {
    X: MUD_ROW[MUD_ROW.length - 1].X + Math.floor((q - (MUD_ROW.length - 1)) / 2),
    Y: MUD_ROW[MUD_ROW.length - 1].Y - (q - (MUD_ROW.length - 1)),
  };
  return {
    X: Math.round(base.X + r * INWARD_VECTOR.xPerStep),
    Y: Math.round(base.Y + r * INWARD_VECTOR.yPerStep),
  };
}

const CELLS = buildCells();
const BOUNDS = (() => {
  const xs = CELLS.map((c) => c.x);
  const ys = CELLS.map((c) => c.y);
  return {
    minX: Math.min(...xs) - HEX_SIZE * 2,
    maxX: Math.max(...xs) + HEX_SIZE * 2,
    minY: Math.min(...ys) - HEX_SIZE * 2,
    maxY: Math.max(...ys) + HEX_SIZE * 2,
  };
})();

const DEFAULT_LEGEND = {
  player: { label: "Player", color: "#22c55e" },
  hq: { label: "HQ", color: "#0ea5e9" },
  refinery: { label: "Refinery", color: "#f59e0b" },
  medical: { label: "Medical Tent", color: "#ec4899" },
  military: { label: "Military Base", color: "#ef4444" },
  mine: { label: "Mine", color: "#fbbf24" },
  boss: { label: "Boss", color: "#a855f7" },
  label: { label: "Ground Label", color: "#111827" },
  note: { label: "Ground Note", color: "#fef08a" },
  arrow: { label: "Arrow", color: "#60a5fa" },
};

function createEntity(type, q, r) {
  const base = {
    id: makeId(type),
    kind: "entity",
    type,
    q,
    r,
    label: DEFAULT_LEGEND[type]?.label || type,
    note: "",
    color: DEFAULT_LEGEND[type]?.color || "#94a3b8",
    locked: false,
    size: type === "hq" ? 7 : 1,
  };
  if (type === "player") {
    base.label = "Player";
    base.callsign = "Alpha";
  }
  if (type === "hq") {
    base.label = "HQ";
    base.callsign = "HQ";
  }
  if (type === "refinery") base.label = "Refinery";
  if (type === "medical") base.label = "Med Tent";
  if (type === "military") base.label = "Mil Base";
  if (type === "mine") base.label = "Mine";
  if (type === "boss") base.label = "Boss";
  return base;
}

function createGroundItem(type, q, r, text = "") {
  return {
    id: makeId(type),
    kind: type,
    type,
    q,
    r,
    text: text || (type === "note" ? "Ground note" : "Label"),
    color: DEFAULT_LEGEND[type]?.color || "#111827",
    locked: false,
  };
}

function createArrow(q, r, color = DEFAULT_LEGEND.arrow.color) {
  return {
    id: makeId("arrow"),
    kind: "arrow",
    startQ: q,
    startR: r,
    endQ: Math.min(GRID_COLS - 1, q + 2),
    endR: r,
    color,
    label: "Arrow",
    locked: false,
  };
}

function defaultBoard(id, name) {
  return {
    id,
    name,
    legend: clone(DEFAULT_LEGEND),
    entities: [],
    groundItems: [],
    arrows: [],
    formations: [],
    notes: "",
  };
}

function seedBoard(board) {
  if (board.id === "canyon") {
    const hq1 = createEntity("hq", 8, 16);
    hq1.label = "Lulucabra HQ";
    const hq2 = createEntity("hq", 18, 10);
    hq2.label = "Alliance HQ";
    const p1 = createEntity("player", 22, 17);
    p1.label = "Shotcaller";
    p1.callsign = "Boomshot";
    const p2 = createEntity("player", 12, 13);
    p2.label = "Hexie";
    p2.callsign = "Hexie";
    board.entities.push(
      hq1,
      hq2,
      createEntity("refinery", 16, 6),
      createEntity("medical", 25, 12),
      createEntity("military", 28, 8),
      createEntity("mine", 7, 21),
      createEntity("boss", 31, 4),
      p1,
      p2
    );
    board.groundItems.push(createGroundItem("label", 20, 8, "Upper push lane"));
    board.groundItems.push(createGroundItem("note", 11, 19, "Rally area / teleport entry"));
    board.arrows.push(createArrow(22, 17, "#22c55e"));
    const counter = createArrow(12, 13, "#ef4444");
    counter.endQ = 18;
    counter.endR = 11;
    counter.label = "Counter";
    board.arrows.push(counter);
  }
  if (board.id === "defense") {
    const e1 = createEntity("hq", 14, 14);
    e1.label = "Defense HQ";
    const e2 = createEntity("player", 14, 8);
    e2.label = "Wall 1";
    const e3 = createEntity("player", 15, 8);
    e3.label = "Wall 2";
    board.entities.push(e1, createEntity("military", 18, 10), createEntity("medical", 10, 17), e2, e3);
    board.groundItems.push(createGroundItem("label", 15, 12, "Hold line"));
  }
  if (board.id === "offense") {
    const hq = createEntity("hq", 11, 15);
    hq.label = "Offense HQ";
    const s1 = createEntity("player", 16, 14);
    s1.label = "Strike 1";
    const s2 = createEntity("player", 17, 13);
    s2.label = "Strike 2";
    board.entities.push(hq, createEntity("refinery", 24, 12), s1, s2);
    const push = createArrow(16, 14, "#38bdf8");
    push.endQ = 24;
    push.endR = 11;
    push.label = "Main push";
    board.arrows.push(push);
  }
  if (board.id === "reserve") {
    const hq = createEntity("hq", 9, 18);
    hq.label = "Reserve HQ";
    board.entities.push(hq, createEntity("medical", 14, 16), createEntity("mine", 21, 19));
    board.groundItems.push(createGroundItem("note", 10, 10, "Flex force / late rotation"));
  }
  return board;
}

function createDefaultRoom() {
  const boards = {};
  [
    ["canyon", "Canyon Clash"],
    ["defense", "Defense Board"],
    ["offense", "Offense Board"],
    ["reserve", "Reserve / Staging"],
  ].forEach(([id, name]) => {
    boards[id] = seedBoard(defaultBoard(id, name));
  });
  return {
    roomName: "AGX War Room",
    activeBoardId: "canyon",
    activePhaseId: "phase-1",
    voicePlan: {
      commandLink: "",
      defenseLink: "",
      offenseLink: "",
      reserveLink: "",
      notes: "Use Discord / Google Meet / Slack Huddle links here for fast coordination.",
    },
    timeline: [
      { id: "phase-1", name: "Phase 1", time: "T-15", objective: "Claim lanes / set walls", boardId: "defense" },
      { id: "phase-2", name: "Phase 2", time: "T+00", objective: "Push Canyon objectives", boardId: "canyon" },
      { id: "phase-3", name: "Phase 3", time: "T+10", objective: "Collapse / rotate reserves", boardId: "offense" },
    ],
    boards,
    updatedAt: Date.now(),
  };
}

function entityCenter(entity) {
  return axialToPixel(entity.q, entity.r);
}

function mudBoundaryPoints() {
  const pts = [];
  for (let q = 0; q < GRID_COLS; q++) {
    const p = axialToPixel(q, 0);
    pts.push({ x: p.x, y: p.y });
  }
  return pts;
}

export default function Page() {
  const clientIdRef = useRef(getClientId());
  const db = useMemo(() => getFirebase(), []);
  const svgRef = useRef(null);
  const lastPresenceWriteRef = useRef(0);

  const [roomId, setRoomId] = useState("server-652");
  const [displayName, setDisplayName] = useState("Lulucabra");
  const [role, setRole] = useState("leader");
  const [liveMode, setLiveMode] = useState(true);
  const [status, setStatus] = useState("Local mode");
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState(createDefaultRoom());
  const [selectedTab, setSelectedTab] = useState("boards");
  const [selectedTool, setSelectedTool] = useState("select");
  const [selectedItem, setSelectedItem] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [presence, setPresence] = useState([]);
  const [formationName, setFormationName] = useState("New formation");
  const [draftGroundText, setDraftGroundText] = useState("Label");
  const [draftArrowColor, setDraftArrowColor] = useState("#60a5fa");
  const [gridOpacity, setGridOpacity] = useState(34);
  const [showCoords, setShowCoords] = useState(false);
  const [hoverCoord, setHoverCoord] = useState(null);
  const [gotoX, setGotoX] = useState("520");
  const [gotoY, setGotoY] = useState("539");

  const board = room.boards[room.activeBoardId];
  const currentPhase = room.timeline.find((x) => x.id === room.activePhaseId);
  const mudPts = useMemo(() => mudBoundaryPoints(), []);

  const tokenMap = useMemo(() => {
    const map = new Map();
    board.entities.forEach((entity) => {
      map.set(`${entity.q},${entity.r}`, entity);
      if (entity.size === 7) {
        [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]].forEach(([dq, dr]) => {
          map.set(`${entity.q + dq},${entity.r + dr}`, entity);
        });
      }
    });
    return map;
  }, [board.entities]);

  useEffect(() => {
    const roomFromUrl = new URLSearchParams(window.location.search).get("room");
    if (roomFromUrl) setRoomId(roomFromUrl);
  }, []);

  useEffect(() => {
    if (!liveMode || !db || !roomId) {
      setConnected(false);
      setStatus(db ? "Local mode" : "Firebase not configured");
      return;
    }

    const roomRef = doc(db, "warRoomsElite", roomId);
    const unsubRoom = onSnapshot(roomRef, async (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data && data.boards) setRoom(data);
        setConnected(true);
        setStatus("Live sync active");
      } else {
        const fresh = createDefaultRoom();
        await setDoc(roomRef, { ...fresh, updatedAt: Date.now() });
        setConnected(true);
        setStatus("Room created");
      }
    });

    const presenceRef = collection(db, "warRoomsElite", roomId, "presence");
    const unsubPresence = onSnapshot(presenceRef, (snap) => {
      const items = [];
      snap.forEach((docSnap) => items.push(docSnap.data()));
      const now = Date.now();
      setPresence(items.filter((item) => item && now - (item.updatedAt || 0) < ACTIVE_CURSOR_MS));
    });

    return () => {
      unsubRoom();
      unsubPresence();
    };
  }, [db, liveMode, roomId]);

  useEffect(() => {
    if (!db || !liveMode || !roomId) return;
    const docRef = doc(db, "warRoomsElite", roomId, "presence", clientIdRef.current);
    const beforeUnload = () => deleteDoc(docRef).catch(() => {});
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [db, liveMode, roomId]);

  async function persist(nextRoom) {
    setRoom(nextRoom);
    if (!db || !liveMode || !roomId) return;
    const roomRef = doc(db, "warRoomsElite", roomId);
    await setDoc(roomRef, { ...nextRoom, updatedAt: Date.now() });
  }

  function patchRoom(mutator) {
    const nextRoom = clone(room);
    mutator(nextRoom);
    void persist(nextRoom);
  }

  function patchBoard(mutator) {
    patchRoom((draft) => {
      mutator(draft.boards[draft.activeBoardId], draft);
    });
  }

  function canMove(item) {
    if (!item) return false;
    if (role === "leader") return true;
    if (role === "officer") return !item.locked;
    return false;
  }

  function findSelected() {
    if (!selectedItem) return null;
    if (selectedItem.kind === "entity") return board.entities.find((x) => x.id === selectedItem.id) || null;
    if (selectedItem.kind === "ground") return board.groundItems.find((x) => x.id === selectedItem.id) || null;
    if (selectedItem.kind === "arrow") return board.arrows.find((x) => x.id === selectedItem.id) || null;
    return null;
  }

  const selectedObject = findSelected();

  function updatePresence(point) {
    if (!db || !liveMode || !roomId || !point) return;
    const now = Date.now();
    if (now - lastPresenceWriteRef.current < 120) return;
    lastPresenceWriteRef.current = now;
    const ref = doc(db, "warRoomsElite", roomId, "presence", clientIdRef.current);
    void setDoc(
      ref,
      {
        id: clientIdRef.current,
        name: displayName || "Operator",
        role,
        boardId: room.activeBoardId,
        x: point.x,
        y: point.y,
        updatedAt: now,
        color: role === "leader" ? "#22c55e" : role === "officer" ? "#60a5fa" : "#f59e0b",
      },
      { merge: true }
    );
  }

  function svgPointToHex(clientX, clientY) {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * (BOUNDS.maxX - BOUNDS.minX) + BOUNDS.minX;
    const y = ((clientY - rect.top) / rect.height) * (BOUNDS.maxY - BOUNDS.minY) + BOUNDS.minY;
    const rounded = pixelToAxial(x, y);
    return {
      q: Math.max(0, Math.min(GRID_COLS - 1, rounded.q)),
      r: Math.max(0, Math.min(GRID_ROWS - 1, rounded.r)),
      x,
      y,
      ...serverCoordFor(Math.max(0, Math.min(GRID_COLS - 1, rounded.q)), Math.max(0, Math.min(GRID_ROWS - 1, rounded.r))),
    };
  }

  function setEntityPosition(entityId, q, r) {
    patchBoard((draft) => {
      const entity = draft.entities.find((x) => x.id === entityId);
      if (!entity || !canMove(entity)) return;
      entity.q = Math.max(0, Math.min(GRID_COLS - 1, q));
      entity.r = Math.max(0, Math.min(GRID_ROWS - 1, r));
    });
  }

  function setGroundPosition(id, q, r) {
    patchBoard((draft) => {
      const item = draft.groundItems.find((x) => x.id === id);
      if (!item || !canMove(item)) return;
      item.q = Math.max(0, Math.min(GRID_COLS - 1, q));
      item.r = Math.max(0, Math.min(GRID_ROWS - 1, r));
    });
  }

  function setArrowHandle(arrowId, which, q, r) {
    patchBoard((draft) => {
      const arrow = draft.arrows.find((x) => x.id === arrowId);
      if (!arrow || !canMove(arrow)) return;
      if (which === "start") {
        arrow.startQ = Math.max(0, Math.min(GRID_COLS - 1, q));
        arrow.startR = Math.max(0, Math.min(GRID_ROWS - 1, r));
      } else {
        arrow.endQ = Math.max(0, Math.min(GRID_COLS - 1, q));
        arrow.endR = Math.max(0, Math.min(GRID_ROWS - 1, r));
      }
    });
  }

  function deleteSelectedDirect(kind, id) {
    if (role === "member") return;
    patchBoard((draft) => {
      if (kind === "entity") draft.entities = draft.entities.filter((x) => x.id !== id);
      if (kind === "ground") draft.groundItems = draft.groundItems.filter((x) => x.id !== id);
      if (kind === "arrow") draft.arrows = draft.arrows.filter((x) => x.id !== id);
    });
    setSelectedItem(null);
  }

  function deleteObjectAtHex(point) {
    if (!point || role === "member") return;
    patchBoard((draft) => {
      const entityIndex = draft.entities.findIndex((entity) => {
        const occupied = [[entity.q, entity.r]];
        if (entity.size === 7) {
          occupied.push(
            [entity.q + 1, entity.r],
            [entity.q - 1, entity.r],
            [entity.q, entity.r + 1],
            [entity.q, entity.r - 1],
            [entity.q + 1, entity.r - 1],
            [entity.q - 1, entity.r + 1]
          );
        }
        return occupied.some(([q, r]) => q === point.q && r === point.r);
      });
      if (entityIndex >= 0) {
        draft.entities.splice(entityIndex, 1);
        return;
      }

      const groundIndex = draft.groundItems.findIndex((item) => item.q === point.q && item.r === point.r);
      if (groundIndex >= 0) {
        draft.groundItems.splice(groundIndex, 1);
        return;
      }

      const arrowIndex = draft.arrows.findIndex(
        (arrow) =>
          (arrow.startQ === point.q && arrow.startR === point.r) ||
          (arrow.endQ === point.q && arrow.endR === point.r)
      );
      if (arrowIndex >= 0) draft.arrows.splice(arrowIndex, 1);
    });
    setSelectedItem(null);
  }

  function addObjectAtPoint(point) {
    if (!point) return;

    if (selectedTool === "delete") {
      deleteObjectAtHex(point);
      return;
    }

    if (selectedTool === "arrow") {
      if (role === "member") return;
      patchBoard((draft) => {
        const arrow = createArrow(point.q, point.r, draftArrowColor);
        draft.arrows.push(arrow);
        setSelectedItem({ kind: "arrow", id: arrow.id });
      });
      return;
    }

    if (selectedTool === "label" || selectedTool === "note") {
      if (role === "member") return;
      const text = draftGroundText || (selectedTool === "note" ? "Ground note" : "Label");
      patchBoard((draft) => {
        const item = createGroundItem(selectedTool, point.q, point.r, text);
        item.color = draft.legend[selectedTool]?.color || item.color;
        draft.groundItems.push(item);
        setSelectedItem({ kind: "ground", id: item.id });
      });
      return;
    }

    if (["player", "hq", "refinery", "medical", "military", "mine", "boss"].includes(selectedTool)) {
      if (role === "member") return;
      patchBoard((draft) => {
        const entity = createEntity(selectedTool, point.q, point.r);
        entity.color = draft.legend[selectedTool]?.color || entity.color;
        draft.entities.push(entity);
        setSelectedItem({ kind: "entity", id: entity.id });
      });
    }
  }

  function handleBoardPointerDown(event) {
    const point = svgPointToHex(event.clientX, event.clientY);
    if (!point) return;
    updatePresence(point);
    if (selectedTool !== "select") addObjectAtPoint(point);
  }

  function handleBoardPointerMove(event) {
    const point = svgPointToHex(event.clientX, event.clientY);
    if (!point) return;
    setHoverCoord(point);
    updatePresence(point);
    if (!dragState) return;
    if (dragState.kind === "entity") setEntityPosition(dragState.id, point.q, point.r);
    if (dragState.kind === "ground") setGroundPosition(dragState.id, point.q, point.r);
    if (dragState.kind === "arrow-start") setArrowHandle(dragState.id, "start", point.q, point.r);
    if (dragState.kind === "arrow-end") setArrowHandle(dragState.id, "end", point.q, point.r);
  }

  function handleBoardPointerUp() {
    setDragState(null);
  }

  function updateSelected(patch) {
    if (!selectedItem) return;
    patchBoard((draft) => {
      let target = null;
      if (selectedItem.kind === "entity") target = draft.entities.find((x) => x.id === selectedItem.id);
      if (selectedItem.kind === "ground") target = draft.groundItems.find((x) => x.id === selectedItem.id);
      if (selectedItem.kind === "arrow") target = draft.arrows.find((x) => x.id === selectedItem.id);
      if (!target) return;
      Object.assign(target, patch);
    });
  }

  function deleteSelected() {
    if (!selectedItem || role === "member") return;
    deleteSelectedDirect(selectedItem.kind, selectedItem.id);
  }

  function saveFormation() {
    if (!formationName.trim()) return;
    patchBoard((draft) => {
      draft.formations.push({
        id: makeId("formation"),
        name: formationName.trim(),
        entities: clone(draft.entities),
        groundItems: clone(draft.groundItems),
        arrows: clone(draft.arrows),
        savedAt: Date.now(),
      });
    });
  }

  function loadFormation(formationId) {
    patchBoard((draft) => {
      const found = draft.formations.find((x) => x.id === formationId);
      if (!found) return;
      draft.entities = clone(found.entities);
      draft.groundItems = clone(found.groundItems);
      draft.arrows = clone(found.arrows);
    });
  }

  function deleteFormation(formationId) {
    patchBoard((draft) => {
      draft.formations = draft.formations.filter((x) => x.id !== formationId);
    });
  }

  function copyHoverCoord() {
    if (!hoverCoord) return;
    navigator.clipboard.writeText(`X:${hoverCoord.X} Y:${hoverCoord.Y}`);
    setStatus(`Copied X:${hoverCoord.X} Y:${hoverCoord.Y}`);
  }

  function goToCoordinate() {
    const x = parseInt(gotoX, 10);
    const y = parseInt(gotoY, 10);
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    let best = null;
    let bestDist = Infinity;
    for (const cell of CELLS) {
      const d = Math.abs(cell.serverX - x) + Math.abs(cell.serverY - y);
      if (d < bestDist) {
        bestDist = d;
        best = cell;
      }
    }
    if (best) {
      setHoverCoord(best);
      setStatus(`Nearest tile → X:${best.serverX} Y:${best.serverY}`);
    }
  }

  function renderEntityShape(entity) {
    const center = entityCenter(entity);
    const occupied = [{ q: entity.q, r: entity.r }];
    if (entity.size === 7) {
      occupied.push(
        { q: entity.q + 1, r: entity.r },
        { q: entity.q - 1, r: entity.r },
        { q: entity.q, r: entity.r + 1 },
        { q: entity.q, r: entity.r - 1 },
        { q: entity.q + 1, r: entity.r - 1 },
        { q: entity.q - 1, r: entity.r + 1 }
      );
    }
    const isSelected = selectedItem?.kind === "entity" && selectedItem.id === entity.id;

    return (
      <g
        key={entity.id}
        className="draggable-group"
        onPointerDown={(e) => {
          e.stopPropagation();
          setSelectedItem({ kind: "entity", id: entity.id });
          if (selectedTool === "delete") {
            deleteSelectedDirect("entity", entity.id);
            return;
          }
          if (canMove(entity) && selectedTool === "select") setDragState({ kind: "entity", id: entity.id });
        }}
      >
        {occupied.map((cell, idx) => {
          const p = axialToPixel(cell.q, cell.r);
          return (
            <polygon
              key={`${entity.id}-${idx}`}
              points={hexPoints(p.x, p.y, entity.size === 7 ? HEX_SIZE - 1 : HEX_SIZE - 3)}
              fill={entity.color}
              fillOpacity={idx === 0 ? 0.92 : 0.62}
              stroke={isSelected ? "#111827" : "rgba(255,255,255,0.58)"}
              strokeWidth={isSelected ? 2.2 : 1.05}
            />
          );
        })}
        <text x={center.x} y={center.y - 2} textAnchor="middle" fontSize="10" fontWeight="700" fill="#ffffff">
          {entity.label}
        </text>
        {entity.callsign ? (
          <text x={center.x} y={center.y + 10} textAnchor="middle" fontSize="7.5" fill="rgba(255,255,255,0.95)">
            {entity.callsign}
          </text>
        ) : null}
      </g>
    );
  }

  function renderGroundItem(item) {
    const p = axialToPixel(item.q, item.r);
    const selected = selectedItem?.kind === "ground" && selectedItem.id === item.id;
    const width = Math.max(60, (item.text || "").length * 7.2);
    return (
      <g
        key={item.id}
        className="draggable-group"
        onPointerDown={(e) => {
          e.stopPropagation();
          setSelectedItem({ kind: "ground", id: item.id });
          if (selectedTool === "delete") {
            deleteSelectedDirect("ground", item.id);
            return;
          }
          if (canMove(item) && selectedTool === "select") setDragState({ kind: "ground", id: item.id });
        }}
      >
        <rect
          x={p.x - width / 2}
          y={p.y - 18}
          width={width}
          height={26}
          rx={10}
          fill={item.kind === "note" ? "rgba(254,240,138,0.96)" : "rgba(255,255,255,0.96)"}
          stroke={selected ? "#111827" : "rgba(17,24,39,0.28)"}
          strokeWidth={selected ? 2 : 1}
        />
        <text x={p.x} y={p.y - 1} textAnchor="middle" fontSize="11" fontWeight="700" fill="#111827">
          {item.text}
        </text>
      </g>
    );
  }

  function renderArrow(arrow) {
    const s = axialToPixel(arrow.startQ, arrow.startR);
    const e = axialToPixel(arrow.endQ, arrow.endR);
    const selected = selectedItem?.kind === "arrow" && selectedItem.id === arrow.id;
    const angle = Math.atan2(e.y - s.y, e.x - s.x);
    const headSize = 12;
    const hx1 = e.x - headSize * Math.cos(angle - Math.PI / 6);
    const hy1 = e.y - headSize * Math.sin(angle - Math.PI / 6);
    const hx2 = e.x - headSize * Math.cos(angle + Math.PI / 6);
    const hy2 = e.y - headSize * Math.sin(angle + Math.PI / 6);

    return (
      <g
        key={arrow.id}
        onPointerDown={(evt) => {
          evt.stopPropagation();
          setSelectedItem({ kind: "arrow", id: arrow.id });
          if (selectedTool === "delete") deleteSelectedDirect("arrow", arrow.id);
        }}
      >
        <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke={arrow.color} strokeWidth={selected ? 5 : 3} />
        <polygon points={`${e.x},${e.y} ${hx1},${hy1} ${hx2},${hy2}`} fill={arrow.color} />
        <text x={(s.x + e.x) / 2} y={(s.y + e.y) / 2 - 8} textAnchor="middle" fontSize="11" fontWeight="700" fill="#111827">
          {arrow.label}
        </text>
        {selected && selectedTool === "select" ? (
          <>
            <circle
              cx={s.x}
              cy={s.y}
              r="8"
              fill="#ffffff"
              stroke={arrow.color}
              strokeWidth="3"
              onPointerDown={(e2) => {
                e2.stopPropagation();
                if (canMove(arrow)) setDragState({ kind: "arrow-start", id: arrow.id });
              }}
            />
            <circle
              cx={e.x}
              cy={e.y}
              r="8"
              fill="#ffffff"
              stroke={arrow.color}
              strokeWidth="3"
              onPointerDown={(e2) => {
                e2.stopPropagation();
                if (canMove(arrow)) setDragState({ kind: "arrow-end", id: arrow.id });
              }}
            />
          </>
        ) : null}
      </g>
    );
  }

  const mudPolyline = mudPts.map((p) => `${p.x},${p.y}`).join(" ");
  const mudFillPoints = [
    `${BOUNDS.minX},${BOUNDS.minY}`,
    ...mudPts.map((p) => `${p.x},${p.y}`),
    `${BOUNDS.minX},${BOUNDS.maxY}`,
  ].join(" ");
  const grassFillPoints = [
    `${BOUNDS.maxX},${BOUNDS.minY}`,
    ...mudPts.slice().reverse().map((p) => `${p.x},${p.y}`),
    `${BOUNDS.maxX},${BOUNDS.maxY}`,
  ].join(" ");

  return (
    <main className="warroom-page">
      <div className="warroom-grid">
        <aside className="sidebar-panel">
          <div className="header-block">
            <div>
              <h1>Last Z War Room Elite</h1>
              <p className="subtle">
                Coordinate-accurate Canyon Clash planner using your 35 mud-edge anchors and verified inward vector.
              </p>
            </div>
            <div className="status-stack">
              <span className="status-pill">{connected ? "Connected" : "Offline"}</span>
              <span className="status-pill">{status}</span>
            </div>
          </div>

          <div className="section">
            <div className="section-title">Accuracy model</div>
            <div className="instruction-box">
              <div><strong>Mud row:</strong> 35 anchor tiles loaded exactly from your server coordinates.</div>
              <div><strong>Inward step:</strong> calibrated from (518,535) → (520,539) over 5 hexes.</div>
              <div><strong>Coords:</strong> hover or click tiles to see real server X:Y values.</div>
            </div>
          </div>

          <div className="section">
            <div className="section-title">Room</div>
            <label className="field-label">Room ID</label>
            <div className="row">
              <input value={roomId} onChange={(e) => setRoomId(e.target.value)} />
              <button
                onClick={() => {
                  const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
                  navigator.clipboard.writeText(url);
                  setStatus("Room link copied");
                }}
              >
                Copy
              </button>
            </div>
            <div className="two-col">
              <div>
                <label className="field-label">Callsign</label>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </div>
              <div>
                <label className="field-label">Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="leader">Leader</option>
                  <option value="officer">Officer</option>
                  <option value="member">Member</option>
                </select>
              </div>
            </div>
          </div>

          <div className="section">
            <div className="section-title">Go to coordinate</div>
            <div className="two-col">
              <input value={gotoX} onChange={(e) => setGotoX(e.target.value)} placeholder="X" />
              <input value={gotoY} onChange={(e) => setGotoY(e.target.value)} placeholder="Y" />
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button onClick={goToCoordinate}>Find nearest tile</button>
              <button className="secondary" onClick={copyHoverCoord}>Copy hover coord</button>
            </div>
            <div className="subtle">
              {hoverCoord ? `Current: X:${hoverCoord.X} Y:${hoverCoord.Y}` : "Hover over the board to inspect coordinates."}
            </div>
          </div>

          <div className="tab-row">
            {["boards", "objects", "formations", "timeline", "voice", "inspect"].map((tab) => (
              <button key={tab} className={selectedTab === tab ? "mini-tab active" : "mini-tab"} onClick={() => setSelectedTab(tab)}>
                {tab}
              </button>
            ))}
          </div>

          {selectedTab === "boards" && (
            <div className="section stack-gap">
              <div className="section-title">Boards</div>
              <div className="board-list">
                {BOARD_IDS.map((id) => (
                  <button key={id} className={room.activeBoardId === id ? "board-chip active" : "board-chip"} onClick={() => patchRoom((draft) => { draft.activeBoardId = id; })}>
                    {room.boards[id].name}
                  </button>
                ))}
              </div>

              <label className="field-label">Board notes</label>
              <textarea value={board.notes} onChange={(e) => patchBoard((draft) => { draft.notes = e.target.value; })} />

              <div className="legend-grid">
                {Object.entries(board.legend).map(([key, value]) => (
                  <div key={key} className="legend-card">
                    <div className="legend-name">{value.label}</div>
                    <input
                      type="color"
                      value={value.color}
                      onChange={(e) =>
                        patchBoard((draft) => {
                          draft.legend[key].color = e.target.value;
                          draft.entities.forEach((ent) => { if (ent.type === key) ent.color = e.target.value; });
                          draft.groundItems.forEach((item) => { if (item.type === key) item.color = e.target.value; });
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedTab === "objects" && (
            <div className="section stack-gap">
              <div className="section-title">Builder palette</div>
              <div className="tool-grid">
                {TOOLS.map((tool) => (
                  <button key={tool.id} className={selectedTool === tool.id ? "tool-chip active" : "tool-chip"} onClick={() => setSelectedTool(tool.id)}>
                    {tool.label}
                  </button>
                ))}
              </div>
              <label className="field-label">Ground text</label>
              <input value={draftGroundText} onChange={(e) => setDraftGroundText(e.target.value)} />
              <label className="field-label">Arrow color</label>
              <input type="color" value={draftArrowColor} onChange={(e) => setDraftArrowColor(e.target.value)} />
              <div className="subtle">Delete Tool removes objects directly from the map. HQ uses 7 linked hexes.</div>
            </div>
          )}

          {selectedTab === "formations" && (
            <div className="section stack-gap">
              <div className="section-title">Formations</div>
              <div className="row">
                <input value={formationName} onChange={(e) => setFormationName(e.target.value)} />
                <button onClick={saveFormation}>Save</button>
              </div>
              {board.formations.map((formation) => (
                <div key={formation.id} className="formation-card">
                  <div>
                    <div className="formation-name">{formation.name}</div>
                    <div className="subtle">{new Date(formation.savedAt).toLocaleString()}</div>
                  </div>
                  <div className="row">
                    <button onClick={() => loadFormation(formation.id)}>Load</button>
                    <button className="secondary" onClick={() => deleteFormation(formation.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedTab === "timeline" && (
            <div className="section stack-gap">
              <div className="section-title">Timeline / phases</div>
              {room.timeline.map((phase) => (
                <button key={phase.id} className={room.activePhaseId === phase.id ? "phase-card active" : "phase-card"} onClick={() => patchRoom((draft) => { draft.activePhaseId = phase.id; draft.activeBoardId = phase.boardId; })}>
                  <div className="formation-name">{phase.name} <span className="phase-time">{phase.time}</span></div>
                  <div>{phase.objective}</div>
                  <div className="subtle">Board: {room.boards[phase.boardId].name}</div>
                </button>
              ))}
            </div>
          )}

          {selectedTab === "voice" && (
            <div className="section stack-gap">
              <div className="section-title">Voice coordination layout</div>
              {["commandLink", "defenseLink", "offenseLink", "reserveLink"].map((key) => (
                <div key={key}>
                  <label className="field-label">{key}</label>
                  <input value={room.voicePlan[key] || ""} onChange={(e) => patchRoom((draft) => { draft.voicePlan[key] = e.target.value; })} />
                </div>
              ))}
              <label className="field-label">Voice notes</label>
              <textarea value={room.voicePlan.notes} onChange={(e) => patchRoom((draft) => { draft.voicePlan.notes = e.target.value; })} />
            </div>
          )}

          {selectedTab === "inspect" && (
            <div className="section stack-gap">
              <div className="section-title">Inspector</div>
              {selectedObject ? (
                <>
                  {"label" in selectedObject && (
                    <div>
                      <label className="field-label">Label</label>
                      <input value={selectedObject.label || ""} onChange={(e) => updateSelected({ label: e.target.value })} />
                    </div>
                  )}
                  {"callsign" in selectedObject && (
                    <div>
                      <label className="field-label">Callsign</label>
                      <input value={selectedObject.callsign || ""} onChange={(e) => updateSelected({ callsign: e.target.value })} />
                    </div>
                  )}
                  {"text" in selectedObject && (
                    <div>
                      <label className="field-label">Ground text</label>
                      <textarea value={selectedObject.text || ""} onChange={(e) => updateSelected({ text: e.target.value })} />
                    </div>
                  )}
                  <div>
                    <label className="field-label">Color</label>
                    <input type="color" value={selectedObject.color || "#ffffff"} onChange={(e) => updateSelected({ color: e.target.value })} />
                  </div>
                  {"locked" in selectedObject && (
                    <div className="toggle-card">
                      <div>
                        <div className="toggle-label">Lock position</div>
                        <div className="subtle">Officers cannot move locked objects.</div>
                      </div>
                      <label className="toggle">
                        <input type="checkbox" checked={!!selectedObject.locked} onChange={(e) => updateSelected({ locked: e.target.checked })} />
                        <span />
                      </label>
                    </div>
                  )}
                  {"q" in selectedObject && (
                    <div className="coords-grid">
                      <div>q: {selectedObject.q}</div>
                      <div>r: {selectedObject.r}</div>
                    </div>
                  )}
                  <button className="danger" onClick={deleteSelected}>Delete selected</button>
                </>
              ) : (
                <div className="subtle">Select an entity, arrow, label, or note on the board to edit it here.</div>
              )}
            </div>
          )}
        </aside>

        <section className="main-panel">
          <div className="main-topbar">
            <div>
              <h2>{room.roomName}</h2>
              <div className="subtle">{board.name} • {currentPhase ? `${currentPhase.name} — ${currentPhase.objective}` : "No active phase"}</div>
            </div>
            <div className="top-actions">
              <label className="compact-toggle">
                <span>Server coords</span>
                <input type="checkbox" checked={showCoords} onChange={(e) => setShowCoords(e.target.checked)} />
              </label>
              <label className="compact-toggle">
                <span>Grid</span>
                <input type="range" min="10" max="70" value={gridOpacity} onChange={(e) => setGridOpacity(Number(e.target.value))} />
              </label>
            </div>
          </div>

          <div className="warroom-layout">
            <div className="voice-strip">
              <div className="voice-card"><div className="voice-title">Command Net</div>{room.voicePlan.commandLink ? <a href={room.voicePlan.commandLink} target="_blank" rel="noreferrer">Open link</a> : <span className="subtle">No link set</span>}</div>
              <div className="voice-card"><div className="voice-title">Defense Net</div>{room.voicePlan.defenseLink ? <a href={room.voicePlan.defenseLink} target="_blank" rel="noreferrer">Open link</a> : <span className="subtle">No link set</span>}</div>
              <div className="voice-card"><div className="voice-title">Offense Net</div>{room.voicePlan.offenseLink ? <a href={room.voicePlan.offenseLink} target="_blank" rel="noreferrer">Open link</a> : <span className="subtle">No link set</span>}</div>
            </div>

            <div className="battlefield-shell">
              <svg
                ref={svgRef}
                viewBox={`${BOUNDS.minX} ${BOUNDS.minY} ${BOUNDS.maxX - BOUNDS.minX} ${BOUNDS.maxY - BOUNDS.minY}`}
                className="battlefield-svg"
                preserveAspectRatio="none"
                onPointerDown={handleBoardPointerDown}
                onPointerMove={handleBoardPointerMove}
                onPointerUp={handleBoardPointerUp}
                onPointerLeave={handleBoardPointerUp}
              >
                <polygon points={mudFillPoints} fill="rgba(188,160,118,0.42)" />
                <polygon points={grassFillPoints} fill="rgba(140,166,104,0.25)" />
                <polyline points={mudPolyline} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="6" />
                <polyline points={mudPolyline} fill="none" stroke="rgba(121,222,255,0.50)" strokeWidth="12" />

                {CELLS.map((cell) => {
                  const occupied = tokenMap.get(`${cell.q},${cell.r}`);
                  return (
                    <g key={`${cell.q}-${cell.r}`}>
                      <polygon
                        points={hexPoints(cell.x, cell.y)}
                        fill={occupied ? `${occupied.color}18` : "rgba(255,255,255,0.02)"}
                        stroke={`rgba(90,99,112,${gridOpacity / 100})`}
                        strokeWidth="1.02"
                      />
                      {showCoords && (
                        <text x={cell.x} y={cell.y + 3} textAnchor="middle" fontSize="6.8" fill="rgba(55,65,81,0.8)">
                          {cell.serverX}:{cell.serverY}
                        </text>
                      )}
                    </g>
                  );
                })}

                {board.arrows.map((arrow) => renderArrow(arrow))}
                {board.entities.map((entity) => renderEntityShape(entity))}
                {board.groundItems.map((item) => renderGroundItem(item))}

                {presence
                  .filter((item) => item.boardId === room.activeBoardId && item.id !== clientIdRef.current)
                  .map((cursor) => (
                    <g key={cursor.id} pointerEvents="none">
                      <circle cx={cursor.x} cy={cursor.y} r="8" fill={cursor.color || "#60a5fa"} />
                      <rect x={cursor.x + 12} y={cursor.y - 13} width={Math.max(68, (cursor.name || "Operator").length * 7)} height="24" rx="12" fill="rgba(17,24,39,0.88)" stroke={cursor.color || "#60a5fa"} />
                      <text x={cursor.x + 20} y={cursor.y + 2} fontSize="11" fontWeight="700" fill="#fff">{cursor.name}</text>
                    </g>
                  ))}
              </svg>
            </div>

            <div className="bottom-strip">
              <div className="summary-box">
                <div className="summary-label">Selected tool</div>
                <div className="summary-value">{TOOLS.find((x) => x.id === selectedTool)?.label || selectedTool}</div>
              </div>
              <div className="summary-box">
                <div className="summary-label">Selected object</div>
                <div className="summary-value">{selectedObject?.label || selectedObject?.text || selectedObject?.callsign || selectedObject?.id || "None"}</div>
              </div>
              <div className="summary-box">
                <div className="summary-label">Hover coordinate</div>
                <div className="summary-value">{hoverCoord ? `X:${hoverCoord.X} Y:${hoverCoord.Y}` : "—"}</div>
              </div>
              <div className="summary-box">
                <div className="summary-label">Objects on board</div>
                <div className="summary-value">{board.entities.length + board.groundItems.length + board.arrows.length}</div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
