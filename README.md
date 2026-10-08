# PalmAura

PalmAura is an Expo React Native app that lets someone submit a palm photo for an AI-generated, entertainment-only reading. The mobile app sends the selected image to its backend; the backend owns the OpenAI and Cloudinary credentials, uploads the image to Cloudinary, and returns the generated result.

## Prerequisites

- Node.js 22.13 or newer
- npm
- Expo Go on a phone, or an Android/iOS simulator
- A Cloudinary account and an OpenAI API key for the backend

## Run the mobile app

Install the app dependencies, then start Expo:

```sh
npm install
npm start
```

Use `npm run android`, `npm run ios`, or `npm run web` to launch a specific target. Expo SDK 57 is used; after dependency updates, run `npx expo install --fix` to realign Expo-managed package versions.

Create a local `.env` from the public portion of `.env.example` and set `EXPO_PUBLIC_API_URL` to the backend URL. On a real phone, this must be your computer's LAN address (for example, `http://192.168.1.10:3001`), not `localhost`.

## Run the backend

The API lives in `server/`. Configure and start it separately:

```sh
cd server
npm install
cp ../.env.example .env
npm run dev
```

Set the server-only values in `server/.env`: `OPENAI_API_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`. Then return to the project root and use `npm start` for the mobile client. `npm run server` is a shortcut for starting the backend from the root after its dependencies are installed.

## Deploy the website to Render

PalmAura can deploy as one Render web service: Render builds the Expo website into `dist/`, then the Express server serves both the website and its `/api` routes on the same domain. This avoids exposing keys or configuring a public API URL in the browser.

1. Push this repository to GitHub and create a Render **Blueprint** from it. Render detects `render.yaml`.
2. Add the server-only environment variables in Render: `OPENAI_API_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`.
3. Deploy. The website is available at your Render service URL.

The deployed browser app uses same-origin `/api` endpoints automatically. It also saves the full rendered report image to Cloudinary, in addition to the source palm image.

## Security and privacy

- Do not put an OpenAI API key, Cloudinary API secret, or any other credential in an `EXPO_PUBLIC_*` variable. Everything with that prefix is embedded in the mobile app and is readable by users.
- Palm images and AI calls must go through the backend, which is responsible for Cloudinary uploads and signed server-side requests.
- The OpenAI key shared in the original request should be revoked and replaced immediately. It is intentionally not included in any project file.
- Do not commit `.env` files, generated images, or user data. Cloudinary access should be limited to the project folder and governed by an appropriate retention policy.
- The app must clearly state that readings are AI-generated entertainment, are not factual, medical, legal, financial, or safety advice, and must not be used to make harmful decisions.

## Environment reference

| Variable | Where it belongs | Purpose |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | Mobile `.env` | Base URL of the backend; safe to expose. |
| `OPENAI_API_KEY` | `server/.env` | Server-only OpenAI credential. |
| `OPENAI_MODEL` | `server/.env` | Use `gpt-4o-mini` for this app's affordable image-to-structured-text reading workflow. |
| `CLOUDINARY_CLOUD_NAME` | `server/.env` | Cloudinary account identifier. |
| `CLOUDINARY_API_KEY` | `server/.env` | Cloudinary server credential. |
| `CLOUDINARY_API_SECRET` | `server/.env` | Cloudinary signing secret; never expose it. |
| `CLOUDINARY_FOLDER` | `server/.env` | Optional folder for uploaded palm photos. |
| `CLIENT_ORIGINS` | `server/.env` | Comma-separated allowed web origins. |
| `MAX_UPLOAD_BYTES` | `server/.env` | Maximum accepted image upload size. |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `server/.env` | API abuse-protection settings. |
