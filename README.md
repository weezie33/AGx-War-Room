# Last Z War Room — Deploy-Ready

This package is built for the easiest path:

1. Unzip
2. Upload files to a new GitHub repo
3. Import the repo into Vercel
4. Add Firebase environment variables
5. Deploy

## What's different about this version
- No shadcn setup needed
- No missing UI component files
- Plain Next.js app router project
- Firebase Firestore live sync already wired in

## Files you care about
- `app/page.tsx` — main app
- `app/globals.css` — styling
- `.env.local.example` — Firebase variables to copy into Vercel
- `firestore.rules` — starter Firestore rules
- `vercel.json` — Vercel config

## Firebase setup
In Firebase:
1. Create a project
2. Add a Web app
3. Create Firestore database
4. Copy the Firebase config values into Vercel Environment Variables

## Vercel env vars
Add these in Vercel Project Settings → Environment Variables:
- NEXT_PUBLIC_FIREBASE_API_KEY
- NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
- NEXT_PUBLIC_FIREBASE_PROJECT_ID
- NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
- NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
- NEXT_PUBLIC_FIREBASE_APP_ID

## GitHub upload
You can create a new repo on GitHub and upload the unzipped files directly in the browser.

## Default room
The app starts on:
- Room ID: `server-652`

You can share a room by using the copy link button in the app.

## Firestore rules
The included `firestore.rules` file is open for trusted-team testing only.
For production security, you should later add Firebase Authentication and tighter rules.
