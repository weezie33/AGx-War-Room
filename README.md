# Last Z War Room Elite v2

## How to use
1. Open the app and choose a Room ID.
2. Set your role:
   - Leader: full control
   - Officer: can move unlocked items
   - Member: read-only
3. Pick a board: Canyon, Defense, Offense, or Reserve.
4. Pick a tool:
   - Player, HQ, Refinery, Medical Tent, Military Base, Mine, Boss
   - Ground Label, Ground Note
   - Arrow
5. Click the map to add a new object.
6. Click an object to select it.
7. Drag the selected object to reposition it.
8. Use the Inspector tab to:
   - rename labels
   - change callsigns
   - recolor
   - lock or unlock
   - delete selected objects
9. Use Formations to save and load multiple layouts.
10. Use Timeline to switch between phase plans.
11. Use Voice to paste Discord / Meet / Slack links.

## Object add / delete
- Add: choose a tool and click the map
- Delete: select the object, open Inspect, click Delete selected

## Firestore paths
- warRoomsElite/{roomId}
- warRoomsElite/{roomId}/presence/{clientId}
