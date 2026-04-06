"use client";

import { useEffect, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

/* ---------- CONFIG ---------- */

const HEX_SIZE = 28;
const SQRT3 = Math.sqrt(3);
const GRID_COLS = 17;
const GRID_ROWS = 14;

/* ---------- TYPES ---------- */

type Token = {
  id: string;
  q: number;
  r: number;
  label: string;
};

type Room = {
  tokens: Token[];
};

/* ---------- DEFAULT ---------- */

const DEFAULT_ROOM: Room = {
  tokens: [
    { id: "1", q: 2, r: 5, label: "1" },
    { id: "2", q: 3, r: 6, label: "2" },
  ],
};

/* ---------- FIREBASE ---------- */

function getDB() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  if (!Object.values(config).every(Boolean)) return null;

  const app = getApps()[0] ?? initializeApp(config);
  return getFirestore(app);
}

/* ---------- HEX UTILS ---------- */

function axialToPixel(q: number, r: number) {
  return {
    x: HEX_SIZE * SQRT3 * (q + r / 2),
    y: HEX_SIZE * 1.5 * r,
  };
}

function hexPoints(x: number, y: number) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((60 * i - 30) * Math.PI) / 180;
    pts.push(`${x + HEX_SIZE * Math.cos(angle)},${y + HEX_SIZE * Math.sin(angle)}`);
  }
  return pts.join(" ");
}

/* ---------- APP ---------- */

export default function Page() {
  const [roomId, setRoomId] = useState("server-652");
  const [room, setRoom] = useState<Room>(DEFAULT_ROOM);
  const db = useMemo(() => getDB(), []);

  useEffect(() => {
    if (!db) return;

    const ref = doc(db, "warRooms", roomId);

    return onSnapshot(ref, async (snap) => {
      if (snap.exists()) {
        setRoom(snap.data() as Room);
      } else {
        await setDoc(ref, {
          ...DEFAULT_ROOM,
          updatedAt: serverTimestamp(),
        });
      }
    });
  }, [db, roomId]);

  function moveToken(id: string, q: number, r: number) {
    const updated = {
      ...room,
      tokens: room.tokens.map((t) =>
        t.id === id ? { ...t, q, r } : t
      ),
    };
    setRoom(updated);

    if (!db) return;
    const ref = doc(db, "warRooms", roomId);
    setDoc(ref, updated);
  }

  return (
    <main style={{ padding: 20 }}>
      <h1>Last Z War Room</h1>

      <input
        value={roomId}
        onChange={(e) => setRoomId(e.target.value)}
      />

      <svg width="800" height="600">
        {room.tokens.map((t) => {
          const { x, y } = axialToPixel(t.q, t.r);
          return (
            <g
              key={t.id}
              onClick={() => moveToken(t.id, t.q + 1, t.r)}
              style={{ cursor: "pointer" }}
            >
              <polygon
                points={hexPoints(x, y)}
                fill="orange"
                stroke="white"
              />
              <text x={x} y={y} textAnchor="middle" fill="white">
                {t.label}
              </text>
            </g>
          );
        })}
      </svg>
    </main>
  );
}
