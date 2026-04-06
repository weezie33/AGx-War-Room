# Last Z War Room Elite

Deploy-ready Next.js package for a richer Last Z Survival planning tool.

## Included
- Leader / officer / member role model
- Lock positions
- Live cursors with Firestore presence
- Multiple boards
- Timeline phases
- Save multiple formations
- Canyon Clash board with:
  - Refineries
  - Medical Tents
  - Military Bases
  - Mines
  - Boss
  - HQs with 7-hex footprint
- Ground labels and notes
- Adjustable arrows
- Voice coordination layout panel with external links such as Discord / Meet

## Important
This version includes a voice coordination layout and quick-link panel.
It does not include built-in browser voice chat. For that you would need extra WebRTC / TURN infrastructure.

## Firestore
This app uses:
- `warRoomsElite/{roomId}` for room state
- `warRoomsElite/{roomId}/presence/{clientId}` for live cursors

## Deploy
1. Replace your GitHub repo files with these files
2. Push to GitHub
3. Vercel will auto-redeploy
4. Make sure your Firebase environment variables are set in Vercel
