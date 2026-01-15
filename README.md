**Number Band Bot**

**About**

A trading bot simulator and live trading application for hyperscalp strategies.

**Prerequisites:** 

1. Clone the repository
2. Navigate to the project directory
3. Install dependencies: `npm install`

**Environment Setup**

For live trading features, create a `.env` file in the root directory:

```
ALPACA_API_KEY=your_api_key_here
ALPACA_API_SECRET=your_api_secret_here
```

**Run the app:**

### Option 1: Run both frontend and backend together (Recommended)
```bash
npm run dev:all
```

This will start:
- Backend server on port 3001 (handles Alpaca WebSocket and API)
- Frontend dev server on port 5173

### Option 2: Run separately

Terminal 1 - Backend:
```bash
npm run dev:server
```

Terminal 2 - Frontend:
```bash
npm run dev
```

The app will run on `http://localhost:5173` (or the next available port).

**Build for production:**

```bash
npm run build
```

**Development:**

- The app includes a simulator mode for testing trading strategies
- Live mode requires Alpaca API credentials (set in `.env` file)
- The backend server provides WebSocket proxying to Alpaca and handles trade execution
- Check the terminal for detailed logs when using live mode
