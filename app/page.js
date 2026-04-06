"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import { collection, doc, getFirestore, onSnapshot, setDoc, deleteDoc } from "firebase/firestore";
import * as XLSX from "xlsx";

const HEX_SIZE = 18;
const SQRT3 = Math.sqrt(3);
const GRID_COLS = 100;
const GRID_ROWS = 100;
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

const DEFAULT_BASE = {
  q: 0,
  r: 0,
  X: 518,
  Y: 535,
  xStep: (520 - 518) / 5,
  yStep: (539 - 535) / 5,
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

function createEntity(type, q, r) {
  const colorMap = {
    player: "#22c55e",
    hq: "#0ea5e9",
    refinery: "#f59e0b",
    medical: "#ec4899",
    military: "#ef4444",
    mine: "#fbbf24",
    boss: "#a855f7",
  };
  const base = {
    id: makeId(type),
    kind: "entity",
    type,
    q,
    r,
    label: type === "medical" ? "Med Tent" : type === "military" ? "Mil Base" : type.toUpperCase(),
    callsign: type === "player" ? "Alpha" : type === "hq" ? "HQ" : "",
    color: colorMap[type] || "#94a3b8",
    locked: false,
    size: type === "hq" ? 7 : 1,
  };
  if (type === "player") base.label = "Player";
  if (type === "hq") base.label = "HQ";
  if (type === "refinery") base.label = "Refinery";
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
    color: type === "note" ? "#fef08a" : "#111827",
    locked: false,
  };
}

function createArrow(q, r, color = "#60a5fa") {
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
    hq1.color = "#3b82f6";
    const hq2 = createEntity("hq", 18, 10);
    hq2.label = "Alliance HQ";
    hq2.color = "#ef4444";
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
    coordinateBase: clone(DEFAULT_BASE),
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

function getEntityCells(entity) {
  const cells = [{ q: entity.q, r: entity.r }];
  if (entity.size === 7) {
    cells.push(
      { q: entity.q + 1, r: entity.r },
      { q: entity.q - 1, r: entity.r },
      { q: entity.q, r: entity.r + 1 },
      { q: entity.q, r: entity.r - 1 },
      { q: entity.q + 1, r: entity.r - 1 },
      { q: entity.q - 1, r: entity.r + 1 }
    );
  }
  return cells;
}

export default function Page() {
  const clientIdRef = useRef(getClientId());
  const db = useMemo(() => getFirebase(), []);
  const svgRef = useRef(null);
  const boardContainerRef = useRef(null);
  const miniMapRef = useRef(null);
  const lastPresenceWriteRef = useRef(0);

  const [roomId, setRoomId] = useState("server-652");
  const [displayName, setDisplayName] = useState("Lulucabra");
  const [role, setRole] = useState("leader");
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
  const [gridOpacity, setGridOpacity] = useState(28);
  const [showCoords, setShowCoords] = useState(false);
  const [hoverCoord, setHoverCoord] = useState(null);
  const [gotoX, setGotoX] = useState("520");
  const [gotoY, setGotoY] = useState("539");
  const [zoom, setZoom] = useState(1);
  const [liveMode, setLiveMode] = useState(true);
  const [searchHighlight, setSearchHighlight] = useState(null);
  const [hoveredObject, setHoveredObject] = useState(null);

  const board = room.boards[room.activeBoardId];
  const base = room.coordinateBase || DEFAULT_BASE;

  const cells = useMemo(() => {
    const built = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let q = 0; q < GRID_COLS; q++) {
        const p = axialToPixel(q, r);
        built.push({
          q,
          r,
          x: p.x,
          y: p.y,
          serverX: Math.round(base.X + (q - base.q) + (r - base.r) * base.xStep),
          serverY: Math.round(base.Y + (q - base.q) * -1 + (r - base.r) * base.yStep),
        });
      }
    }
    return built;
  }, [base]);

  const bounds = useMemo(() => {
    const xs = cells.map((c) => c.x);
    const ys = cells.map((c) => c.y);
    return {
      minX: Math.min(...xs) - HEX_SIZE * 2,
      maxX: Math.max(...xs) + HEX_SIZE * 2,
      minY: Math.min(...ys) - HEX_SIZE * 2,
      maxY: Math.max(...ys) + HEX_SIZE * 2,
    };
  }, [cells]);

  const mudPolyline = useMemo(() => {
    const pts = [];
    for (let q = 0; q < GRID_COLS; q++) {
      const p = axialToPixel(q, 0);
      pts.push(`${p.x},${p.y}`);
    }
    return pts.join(" ");
  }, []);

  const tokenMap = useMemo(() => {
    const map = new Map();
    board.entities.forEach((entity) => {
      getEntityCells(entity).forEach((c) => map.set(`${c.q},${c.r}`, entity));
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
  }, [db, roomId, liveMode]);

  useEffect(() => {
    if (!db || !liveMode || !roomId) return;
    const docRef = doc(db, "warRoomsElite", roomId, "presence", clientIdRef.current);
    const beforeUnload = () => deleteDoc(docRef).catch(() => {});
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [db, roomId, liveMode]);

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

  function pointToHex(clientX, clientY) {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * (bounds.maxX - bounds.minX) + bounds.minX;
    const y = ((clientY - rect.top) / rect.height) * (bounds.maxY - bounds.minY) + bounds.minY;
    const rounded = pixelToAxial(x, y);
    const q = Math.max(0, Math.min(GRID_COLS - 1, rounded.q));
    const r = Math.max(0, Math.min(GRID_ROWS - 1, rounded.r));
    return {
      q,
      r,
      x,
      y,
      serverX: Math.round(base.X + (q - base.q) + (r - base.r) * base.xStep),
      serverY: Math.round(base.Y + (q - base.q) * -1 + (r - base.r) * base.yStep),
    };
  }

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
      const entityIndex = draft.entities.findIndex((entity) =>
        getEntityCells(entity).some((c) => c.q === point.q && c.r === point.r)
      );
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
      patchBoard((draft) => {
        const item = createGroundItem(
          selectedTool,
          point.q,
          point.r,
          draftGroundText || (selectedTool === "note" ? "Ground note" : "Label")
        );
        draft.groundItems.push(item);
        setSelectedItem({ kind: "ground", id: item.id });
      });
      return;
    }
    if (["player", "hq", "refinery", "medical", "military", "mine", "boss"].includes(selectedTool)) {
      if (role === "member") return;
      patchBoard((draft) => {
        const entity = createEntity(selectedTool, point.q, point.r);
        draft.entities.push(entity);
        setSelectedItem({ kind: "entity", id: entity.id });
      });
    }
  }

  function handleBoardPointerDown(event) {
    const point = pointToHex(event.clientX, event.clientY);
    if (!point) return;
    updatePresence(point);
    if (selectedTool !== "select") addObjectAtPoint(point);
  }

  function handleBoardPointerMove(event) {
    const point = pointToHex(event.clientX, event.clientY);
    if (!point) return;
    setHoverCoord(point);
    setHoveredObject(null);
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
    navigator.clipboard.writeText(`X:${hoverCoord.serverX} Y:${hoverCoord.serverY}`);
    setStatus(`Copied X:${hoverCoord.serverX} Y:${hoverCoord.serverY}`);
  }

  function focusBoardOnCell(cell) {
    if (!cell || !boardContainerRef.current) return;
    setHoverCoord(cell);
    const container = boardContainerRef.current;
    const scaleW = container.scrollWidth;
    const scaleH = container.scrollHeight;
    const rx = (cell.x - bounds.minX) / (bounds.maxX - bounds.minX);
    const ry = (cell.y - bounds.minY) / (bounds.maxY - bounds.minY);
    container.scrollLeft = Math.max(0, rx * scaleW - container.clientWidth / 2);
    container.scrollTop = Math.max(0, ry * scaleH - container.clientHeight / 2);
  }

  function goToCoordinate() {
    const x = parseInt(gotoX, 10);
    const y = parseInt(gotoY, 10);
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    let best = null;
    let bestDist = Infinity;
    for (const cell of cells) {
      const d = Math.abs(cell.serverX - x) + Math.abs(cell.serverY - y);
      if (d < bestDist) {
        bestDist = d;
        best = cell;
      }
    }
    if (best) {
      setSearchHighlight(best);
      focusBoardOnCell(best);
      setStatus(`Nearest tile → X:${best.serverX} Y:${best.serverY}`);
    }
  }

  function setBaseFromHover() {
    if (!hoverCoord) return;
    patchRoom((draft) => {
      draft.coordinateBase.q = hoverCoord.q;
      draft.coordinateBase.r = hoverCoord.r;
      draft.coordinateBase.X = hoverCoord.serverX;
      draft.coordinateBase.Y = hoverCoord.serverY;
    });
    setStatus(`Base set to X:${hoverCoord.serverX} Y:${hoverCoord.serverY}`);
  }

  function exportBoardToExcel() {
    const rows = [];
    board.entities.forEach((entity) => {
      getEntityCells(entity).forEach((cell, idx) => {
        const serverX = Math.round(base.X + (cell.q - base.q) + (cell.r - base.r) * base.xStep);
        const serverY = Math.round(base.Y + (cell.q - base.q) * -1 + (cell.r - base.r) * base.yStep);
        rows.push({
          board: board.name,
          object_kind: "entity",
          object_type: entity.type,
          object_label: entity.label,
          callsign: entity.callsign || "",
          object_id: entity.id,
          footprint_index: idx,
          q: cell.q,
          r: cell.r,
          X: serverX,
          Y: serverY,
          color: entity.color,
          locked: entity.locked ? "yes" : "no",
        });
      });
    });
    board.groundItems.forEach((item) => {
      const serverX = Math.round(base.X + (item.q - base.q) + (item.r - base.r) * base.xStep);
      const serverY = Math.round(base.Y + (item.q - base.q) * -1 + (item.r - base.r) * base.yStep);
      rows.push({
        board: board.name,
        object_kind: item.kind,
        object_type: item.type,
        object_label: item.text,
        callsign: "",
        object_id: item.id,
        footprint_index: 0,
        q: item.q,
        r: item.r,
        X: serverX,
        Y: serverY,
        color: item.color,
        locked: item.locked ? "yes" : "no",
      });
    });
    board.arrows.forEach((arrow) => {
      const startX = Math.round(base.X + (arrow.startQ - base.q) + (arrow.startR - base.r) * base.xStep);
      const startY = Math.round(base.Y + (arrow.startQ - base.q) * -1 + (arrow.startR - base.r) * base.yStep);
      const endX = Math.round(base.X + (arrow.endQ - base.q) + (arrow.endR - base.r) * base.xStep);
      const endY = Math.round(base.Y + (arrow.endQ - base.q) * -1 + (arrow.endR - base.r) * base.yStep);
      rows.push({
        board: board.name,
        object_kind: "arrow",
        object_type: "arrow",
        object_label: arrow.label,
        callsign: "",
        object_id: arrow.id,
        footprint_index: 0,
        q: `${arrow.startQ} -> ${arrow.endQ}`,
        r: `${arrow.startR} -> ${arrow.endR}`,
        X: `${startX} -> ${endX}`,
        Y: `${startY} -> ${endY}`,
        color: arrow.color,
        locked: arrow.locked ? "yes" : "no",
      });
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Board Objects");
    XLSX.writeFile(wb, `${board.name.replace(/\s+/g, "_")}_coordinates.xlsx`);
    setStatus("Excel export downloaded");
  }


  function setHoverFromHex(q, r, extra = null) {
    const serverX = Math.round(base.X + (q - base.q) + (r - base.r) * base.xStep);
    const serverY = Math.round(base.Y + (q - base.q) * -1 + (r - base.r) * base.yStep);
    setHoverCoord({ q, r, serverX, serverY });
    setHoveredObject(extra);
  }

  function renderEntityShape(entity) {
    const center = axialToPixel(entity.q, entity.r);
    const occupied = getEntityCells(entity);
    const isSelected = selectedItem?.kind === "entity" && selectedItem.id === entity.id;
    return (
      <g
        key={entity.id}
        className="draggable-group"
        onPointerEnter={() => setHoverFromHex(entity.q, entity.r, { kind: "entity", label: entity.label, callsign: entity.callsign || "", color: entity.color })}
        onPointerMove={() => setHoverFromHex(entity.q, entity.r, { kind: "entity", label: entity.label, callsign: entity.callsign || "", color: entity.color })}
        onPointerLeave={() => setHoveredObject(null)}
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
              points={hexPoints(p.x, p.y, entity.size === 7 ? HEX_SIZE - 1 : HEX_SIZE - 2)}
              fill={entity.color}
              fillOpacity={idx === 0 ? 0.92 : 0.62}
              stroke={isSelected ? "#111827" : "rgba(255,255,255,0.58)"}
              strokeWidth={isSelected ? 2.2 : 1.05}
            />
          );
        })}
        <text x={center.x} y={center.y - 2} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#ffffff">
          {entity.label}
        </text>
        {entity.callsign ? (
          <text x={center.x} y={center.y + 9} textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.95)">
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
        onPointerEnter={() => setHoverFromHex(item.q, item.r, { kind: item.kind, label: item.text, callsign: "", color: item.color })}
        onPointerMove={() => setHoverFromHex(item.q, item.r, { kind: item.kind, label: item.text, callsign: "", color: item.color })}
        onPointerLeave={() => setHoveredObject(null)}
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
        onPointerEnter={() => setHoverFromHex(arrow.startQ, arrow.startR, { kind: "arrow", label: arrow.label, callsign: "", color: arrow.color })}
        onPointerMove={() => setHoverFromHex(arrow.startQ, arrow.startR, { kind: "arrow", label: arrow.label, callsign: "", color: arrow.color })}
        onPointerLeave={() => setHoveredObject(null)}
        onPointerDown={(evt) => {
          evt.stopPropagation();
          setSelectedItem({ kind: "arrow", id: arrow.id });
          if (selectedTool === "delete") deleteSelectedDirect("arrow", arrow.id);
        }}
      >
        <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke={arrow.color} strokeWidth={selected ? 5 : 3} />
        <polygon points={`${e.x},${e.y} ${hx1},${hy1} ${hx2},${hy2}`} fill={arrow.color} />
        <text x={(s.x + e.x) / 2} y={(s.y + e.y) / 2 - 8} textAnchor="middle" fontSize="10" fontWeight="700" fill="#111827">
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

  const selectedTarget = selectedItem
    ? selectedItem.kind === "entity"
      ? board.entities.find((x) => x.id === selectedItem.id)
      : selectedItem.kind === "ground"
      ? board.groundItems.find((x) => x.id === selectedItem.id)
      : board.arrows.find((x) => x.id === selectedItem.id)
    : null;

  const miniMapShapes = {
    entities: board.entities.map((entity) => ({
      id: entity.id,
      q: entity.q,
      r: entity.r,
      color: entity.color,
      size: entity.size,
    })),
    groundItems: board.groundItems.map((item) => ({
      id: item.id,
      q: item.q,
      r: item.r,
      color: item.kind === "note" ? "#eab308" : "#111827",
    })),
    arrows: board.arrows.map((arrow) => ({
      id: arrow.id,
      startQ: arrow.startQ,
      startR: arrow.startR,
      endQ: arrow.endQ,
      endR: arrow.endR,
      color: arrow.color,
    })),
  };

  return (
    <main className="warroom-page">
      <div className="warroom-grid">
        <aside className="sidebar-panel">
          <div className="header-block">
            <div>
              <h1>Last Z War Room Elite v8</h1>
              <p className="subtle">Mini-map, snap highlight, and Excel export added on top of v7.</p>
            </div>
            <div className="status-stack">
              <span className="status-pill">{connected ? "Connected" : "Offline"}</span>
              <span className="status-pill">{status}</span>
            </div>
          </div>

          <div className="section">
            <div className="section-title">How to use</div>
            <div className="instruction-box">
              <div><strong>1.</strong> Choose a tool, then click the map to add objects.</div>
              <div><strong>2.</strong> Use Select to drag objects and arrows.</div>
              <div><strong>3.</strong> Use Delete Tool to remove objects directly from the map.</div>
              <div><strong>4.</strong> Use Find nearest tile to snap and highlight a searched coordinate.</div>
              <div><strong>5.</strong> Use Export Excel to download current board object coordinates.</div>
              <div><strong>6.</strong> Use the mini-map to jump across the battlefield.</div>
            </div>
          </div>

          <div className="section">
            <div className="section-title">Room</div>
            <label className="field-label">Room ID</label>
            <div className="row">
              <input value={roomId} onChange={(e) => setRoomId(e.target.value)} />
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
            <div className="toggle-card">
              <div>
                <div className="toggle-label">Live collaboration</div>
                <div className="subtle">Realtime sync and live cursors.</div>
              </div>
              <label className="toggle">
                <input type="checkbox" checked={liveMode} onChange={(e) => setLiveMode(e.target.checked)} />
                <span />
              </label>
            </div>
          </div>

          <div className="section">
            <div className="section-title">Zoom and coordinates</div>
            <label className="field-label">Zoom</label>
            <input type="range" min="0.5" max="2.5" step="0.1" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
            <div className="subtle">Zoom: {zoom.toFixed(1)}x</div>
            <div className="two-col" style={{ marginTop: 10 }}>
              <input value={gotoX} onChange={(e) => setGotoX(e.target.value)} placeholder="X" />
              <input value={gotoY} onChange={(e) => setGotoY(e.target.value)} placeholder="Y" />
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button onClick={goToCoordinate}>Find nearest tile</button>
              <button className="secondary" onClick={copyHoverCoord}>Copy hover coord</button>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button onClick={setBaseFromHover}>Set base from hover</button>
              <button onClick={exportBoardToExcel}>Export Excel</button>
            </div>
            <div className="subtle">
              {hoverCoord ? `Hover: X:${hoverCoord.serverX} Y:${hoverCoord.serverY} | q:${hoverCoord.q} r:${hoverCoord.r}` : "Hover over the board to inspect coordinates."}
            </div>
            <div className="subtle">
              Base tile: q:{base.q} r:{base.r} → X:{base.X} Y:{base.Y}
            </div>
          </div>

          <div className="section">
            <div className="section-title">Mini-map</div>
            <div className="mini-map-wrap">
              <svg
                ref={miniMapRef}
                viewBox={`0 0 ${GRID_COLS} ${GRID_ROWS}`}
                className="mini-map-svg"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const q = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(((e.clientX - rect.left) / rect.width) * GRID_COLS)));
                  const r = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(((e.clientY - rect.top) / rect.height) * GRID_ROWS)));
                  const cell = cells.find((c) => c.q === q && c.r === r);
                  if (cell) focusBoardOnCell(cell);
                }}
              >
                <rect x="0" y="0" width={GRID_COLS} height={GRID_ROWS} fill="#eef1f5" />
                {miniMapShapes.entities.map((shape) => (
                  <rect key={shape.id} x={shape.q} y={shape.r} width={shape.size === 7 ? 2 : 1} height={shape.size === 7 ? 2 : 1} fill={shape.color} opacity="0.9" />
                ))}
                {miniMapShapes.groundItems.map((shape) => (
                  <rect key={shape.id} x={shape.q} y={shape.r} width="1" height="1" fill={shape.color} opacity="0.9" />
                ))}
                {miniMapShapes.arrows.map((shape) => (
                  <line key={shape.id} x1={shape.startQ + 0.5} y1={shape.startR + 0.5} x2={shape.endQ + 0.5} y2={shape.endR + 0.5} stroke={shape.color} strokeWidth="0.35" />
                ))}
                {searchHighlight ? (
                  <rect x={searchHighlight.q} y={searchHighlight.r} width="1" height="1" fill="none" stroke="#f97316" strokeWidth="0.5" />
                ) : null}
              </svg>
            </div>
          </div>

          <div className="tab-row">
            {["boards", "objects", "formations", "timeline", "inspect"].map((tab) => (
              <button key={tab} className={selectedTab === tab ? "mini-tab active" : "mini-tab"} onClick={() => setSelectedTab(tab)}>
                {tab}
              </button>
            ))}
          </div>

          {selectedTab === "boards" && (
            <div className="section stack-gap">
              <div className="board-list">
                {BOARD_IDS.map((id) => (
                  <button key={id} className={room.activeBoardId === id ? "board-chip active" : "board-chip"} onClick={() => patchRoom((draft) => { draft.activeBoardId = id; })}>
                    {room.boards[id].name}
                  </button>
                ))}
              </div>
              <label className="field-label">Board notes</label>
              <textarea value={board.notes} onChange={(e) => patchBoard((draft) => { draft.notes = e.target.value; })} />
            </div>
          )}

          {selectedTab === "objects" && (
            <div className="section stack-gap">
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
              <div className="subtle">Each object can also be individually recolored later in Inspect.</div>
            </div>
          )}

          {selectedTab === "formations" && (
            <div className="section stack-gap">
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
              {room.timeline.map((phase) => (
                <button key={phase.id} className={room.activePhaseId === phase.id ? "phase-card active" : "phase-card"} onClick={() => patchRoom((draft) => { draft.activePhaseId = phase.id; draft.activeBoardId = phase.boardId; })}>
                  <div className="formation-name">{phase.name} <span className="phase-time">{phase.time}</span></div>
                  <div>{phase.objective}</div>
                </button>
              ))}
            </div>
          )}

          {selectedTab === "inspect" && (
            <div className="section stack-gap">
              {selectedTarget ? (
                <>
                  {"label" in selectedTarget ? (
                    <div>
                      <label className="field-label">Label</label>
                      <input value={selectedTarget.label || ""} onChange={(e) => updateSelected({ label: e.target.value })} />
                    </div>
                  ) : null}
                  {"callsign" in selectedTarget ? (
                    <div>
                      <label className="field-label">Callsign</label>
                      <input value={selectedTarget.callsign || ""} onChange={(e) => updateSelected({ callsign: e.target.value })} />
                    </div>
                  ) : null}
                  {"text" in selectedTarget ? (
                    <div>
                      <label className="field-label">Ground text</label>
                      <textarea value={selectedTarget.text || ""} onChange={(e) => updateSelected({ text: e.target.value })} />
                    </div>
                  ) : null}
                  <div>
                    <label className="field-label">Individual color</label>
                    <input type="color" value={selectedTarget.color || "#ffffff"} onChange={(e) => updateSelected({ color: e.target.value })} />
                  </div>
                  {"locked" in selectedTarget ? (
                    <div className="toggle-card">
                      <div>
                        <div className="toggle-label">Lock position</div>
                        <div className="subtle">Officers cannot move locked objects.</div>
                      </div>
                      <label className="toggle">
                        <input type="checkbox" checked={!!selectedTarget.locked} onChange={(e) => updateSelected({ locked: e.target.checked })} />
                        <span />
                      </label>
                    </div>
                  ) : null}
                  <button className="danger" onClick={() => deleteSelectedDirect(selectedItem.kind, selectedItem.id)}>
                    Delete selected
                  </button>
                </>
              ) : (
                <div className="subtle">Select an object to modify it here.</div>
              )}
            </div>
          )}
        </aside>

        <section className="main-panel">
          <div className="main-topbar">
            <div>
              <h2>{room.roomName}</h2>
              <div className="subtle">100 x 100 square board • mini-map • snap highlight • Excel export</div>
            </div>
            <div className="top-actions">
              <label className="compact-toggle">
                <span>Coords</span>
                <input type="checkbox" checked={showCoords} onChange={(e) => setShowCoords(e.target.checked)} />
              </label>
              <label className="compact-toggle">
                <span>Grid</span>
                <input type="range" min="8" max="50" value={gridOpacity} onChange={(e) => setGridOpacity(Number(e.target.value))} />
              </label>
            </div>
          </div>

          <div className="warroom-layout">
            <div ref={boardContainerRef} className="battlefield-shell">
              <div className="zoom-layer" style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: "fit-content", height: "fit-content" }}>
                <svg
                  ref={svgRef}
                  viewBox={`${bounds.minX} ${bounds.minY} ${bounds.maxX - bounds.minX} ${bounds.maxY - bounds.minY}`}
                  className="battlefield-svg"
                  onPointerDown={handleBoardPointerDown}
                  onPointerMove={handleBoardPointerMove}
                  onPointerUp={handleBoardPointerUp}
                  onPointerLeave={handleBoardPointerUp}
                >
                  {cells.map((cell) => {
                    const occupied = tokenMap.get(`${cell.q},${cell.r}`);
                    const isSearch = searchHighlight && searchHighlight.q === cell.q && searchHighlight.r === cell.r;
                    return (
                      <g key={`${cell.q}-${cell.r}`}>
                        <polygon
                          points={hexPoints(cell.x, cell.y)}
                          fill={isSearch ? "rgba(249,115,22,0.35)" : occupied ? `${occupied.color}18` : "rgba(255,255,255,0.02)"}
                          stroke={isSearch ? "rgba(249,115,22,0.95)" : `rgba(90,99,112,${gridOpacity / 100})`}
                          strokeWidth={isSearch ? "2.2" : "0.95"}
                        />
                        {showCoords ? (
                          <text x={cell.x} y={cell.y + 2} textAnchor="middle" fontSize="5.4" fill="rgba(55,65,81,0.75)">
                            {cell.serverX}:{cell.serverY}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}

                  <polyline points={mudPolyline} fill="none" stroke="rgba(120,130,145,0.45)" strokeWidth="2" strokeDasharray="4 6" />

                  {board.arrows.map((arrow) => renderArrow(arrow))}
                  {board.entities.map((entity) => renderEntityShape(entity))}
                  {board.groundItems.map((item) => renderGroundItem(item))}

                  {presence.filter((item) => item.boardId === room.activeBoardId && item.id !== clientIdRef.current).map((cursor) => (
                    <g key={cursor.id} pointerEvents="none">
                      <circle cx={cursor.x} cy={cursor.y} r="7" fill={cursor.color || "#60a5fa"} />
                      <rect x={cursor.x + 10} y={cursor.y - 12} width={Math.max(68, (cursor.name || "Operator").length * 7)} height="22" rx="11" fill="rgba(17,24,39,0.88)" stroke={cursor.color || "#60a5fa"} />
                      <text x={cursor.x + 18} y={cursor.y + 2} fontSize="10.5" fontWeight="700" fill="#fff">{cursor.name}</text>
                    </g>
                  ))}
                </svg>
              </div>
              {hoveredObject && hoverCoord ? (
                <div className="hover-chip">
                  <div className="hover-chip-title">{hoveredObject.label}</div>
                  <div className="hover-chip-sub">{hoveredObject.kind} • X:{hoverCoord.serverX} Y:{hoverCoord.serverY}{hoveredObject.callsign ? ` • ${hoveredObject.callsign}` : ""}</div>
                </div>
              ) : null}
            </div>

            <div className="bottom-strip">
              <div className="summary-box">
                <div className="summary-label">Selected tool</div>
                <div className="summary-value">{TOOLS.find((x) => x.id === selectedTool)?.label || selectedTool}</div>
              </div>
              <div className="summary-box">
                <div className="summary-label">Hover coordinate</div>
                <div className="summary-value">{hoverCoord ? `X:${hoverCoord.serverX} Y:${hoverCoord.serverY}` : "—"}</div>
              </div>
              <div className="summary-box">
                <div className="summary-label">Hover object</div>
                <div className="summary-value">{hoveredObject ? hoveredObject.label : "—"}</div>
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
