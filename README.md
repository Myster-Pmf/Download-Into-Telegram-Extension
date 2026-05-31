# VideoGrab — Download into Telegram Chrome Extension & Backend

VideoGrab is a premium, state-of-the-art browser companion and self-hosted Node.js backend designed to capture web streams (HLS, DASH, MP4) and transfer them directly into your Telegram chats, channels, or groups. 

By utilizing a high-speed downloader (`yt-dlp`) and native Telegram uploads (`GramJS` / `MTProto`), VideoGrab lets you download large media assets and upload them seamlessly without routing files through your local machine's disk or internet connection.

---

## Key Features

- 🎬 **Automatic Stream Detection**: Captures `.m3u8` (HLS), `.mpd` (DASH), and direct `.mp4` video links in real-time as you play them.
- 🟢 **Dynamic Cookie Extraction**: Automatically extracts active browser cookies (including HttpOnly cookies) for the video site using the Chrome extension API. You never need to manually inspect elements or copy-paste cookie text.
- 📂 **Site-Specific Profiles**: Map domains (e.g. `*.mediadelivery.net`) to custom headers (Origin, Referer, User-Agent) and static cookie overrides.
- ✈️ **Native Telegram Transfers**: Links directly to your Telegram user account to upload files up to 2GB, with automated splitting for larger files.
- ☁️ **Turso SQL Database Support**: Optionally sync session credentials and job queues to a serverless Turso Cloud database.
- 🚀 **Zero-Deploy Minimal Setup**: Use the pre-configured Hugging Face Space backend (`https://lightx99-downloadintotelegram.hf.space`) out of the box.

---

## 💻 Chrome Extension Installation

### Developer Installation (Unpacked Extension)
To install the extension for development or custom builds:
1. **Clone the repository**:
   ```bash
   git clone https://github.com/Myster-Pmf/Download-Into-Telegram-Extension.git
   ```
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Toggle the **"Developer mode"** switch in the top-right corner.
4. Click the **"Load unpacked"** button in the top-left.
5. Select the `extension/` folder inside the cloned repository directory.

### Packed Installation (.zip / .crx)
If you build or distribute a zipped extension:
1. Package the `extension/` directory into a `.zip` archive.
2. Drag and drop the `.zip` (or `.crx` if signed) file directly into the `chrome://extensions/` page to install it instantly.

---

## 🛠️ Configuration & Setup

### 1. Minimal Setup (Zero-Deployment)
If you don't want to deploy your own backend server:
1. Open the VideoGrab popup, click the **Settings** tab.
2. Keep the default backend URL: `https://lightx99-downloadintotelegram.hf.space`
3. Enter your shared secret **API Key** (contact the server operator or use the public space key).
4. Navigate to the **Telegram** tab and complete the login wizard (OTP + 2FA password) to authenticate your user session.
5. Select your default target channel or group from the list, or type a custom ID (e.g. `@mychannel`).

### 2. Self-Hosted Backend Deployment
To host the Node.js backend yourself:

#### Prerequisites
- Node.js (v18 or higher)
- `ffmpeg` installed on the host system (required by `yt-dlp` to merge audio/video tracks)
- Telegram App API Credentials (`API_ID` and `API_HASH`) from [my.telegram.org](https://my.telegram.org)

#### Environment Variables
Create a `.env` file in the `backend/` directory:
```env
PORT=3000
API_KEY=your_secure_shared_secret_api_key

# Telegram API credentials (required)
TG_API_ID=1234567
TG_API_HASH=abcdef0123456789abcdef0123456789

# Optional: Turso SQL DB configuration (falls back to local JSON if empty)
TURSO_DATABASE_URL=libsql://your-database-name.turso.io
TURSO_AUTH_TOKEN=your_turso_auth_token_here
```

#### Run the Server
1. Install dependencies:
   ```bash
   cd backend
   npm install
   ```
2. Start the server:
   ```bash
   npm start
   ```
   For development with hot-reloading:
   ```bash
   npm run dev
   ```

---

## 🍪 Cookie Extraction & Profiles Tab

VideoGrab features a premium **Profiles** tab designed for modern cookie management:
- **Live Sync Mode** (Default): The extension automatically extracts and structures active cookies from the current page in **Netscape Cookie format** before starting any download.
- **Static Override Mode**: Press **Edit** on the fallback card to paste cookies manually or **Import cookies.txt**. 
- **Restore Live Sync**: Discard overrides and return to dynamic sync at any time.
- **Mismatch Warnings**: The UI detects when your custom saved cookies mismatch the live browser cookies and prompts you with a quick sync action.

---

## 🛡️ License
Distributed under the MIT License. See [LICENSE](file:///d:/new_projects/Download%20into%20Telegram/LICENSE) for more details.
