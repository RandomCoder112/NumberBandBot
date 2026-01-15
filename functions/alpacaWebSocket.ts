import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  
  if (!ticker) {
    return new Response('Missing ticker parameter', { status: 400 });
  }

  // Upgrade to WebSocket
  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  
  const apiKey = Deno.env.get('ALPACA_API_KEY');
  const apiSecret = Deno.env.get('ALPACA_API_SECRET');
  
  let alpacaWs = null;
  
  socket.onopen = () => {
    console.log('Client connected, connecting to Alpaca...');
    
    // Connect to Alpaca WebSocket
    alpacaWs = new WebSocket('wss://stream.data.alpaca.markets/v2/iex');
    
    alpacaWs.onopen = () => {
      console.log('Connected to Alpaca, authenticating...');
      // Authenticate
      alpacaWs.send(JSON.stringify({
        action: 'auth',
        key: apiKey,
        secret: apiSecret
      }));
      
      // Subscribe to quotes and trades
      setTimeout(() => {
        console.log(`Subscribing to ${ticker}...`);
        alpacaWs.send(JSON.stringify({
          action: 'subscribe',
          quotes: [ticker],
          trades: [ticker]
        }));
      }, 500);
    };
    
    alpacaWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('Alpaca message:', data);
        
        // Forward all messages to client
        if (Array.isArray(data)) {
          for (const msg of data) {
            if (msg.T === 'q') {
              // Quote message
              console.log(`Quote: ${msg.S} ${msg.bp} x ${msg.ap}`);
              socket.send(JSON.stringify({
                type: 'quote',
                symbol: msg.S,
                bid: msg.bp,
                ask: msg.ap,
                bidSize: msg.bs,
                askSize: msg.as,
                timestamp: msg.t
              }));
            } else if (msg.T === 't') {
              // Trade message
              console.log(`Trade: ${msg.S} ${msg.p}`);
              socket.send(JSON.stringify({
                type: 'trade',
                symbol: msg.S,
                price: msg.p,
                size: msg.s,
                timestamp: msg.t
              }));
            } else if (msg.msg === 'authenticated') {
              console.log('Authenticated with Alpaca');
              socket.send(JSON.stringify({ type: 'status', message: 'Authenticated with Alpaca' }));
            } else if (msg.msg) {
              console.log('Alpaca status:', msg.msg);
              socket.send(JSON.stringify({ type: 'status', message: msg.msg }));
            }
          }
        }
      } catch (err) {
        console.error('Parse error:', err);
        socket.send(JSON.stringify({ type: 'error', message: `Parse error: ${err.message}` }));
      }
    };
    
    alpacaWs.onerror = (error) => {
      console.error('Alpaca WebSocket error:', error);
      socket.send(JSON.stringify({ type: 'error', message: 'Alpaca connection error' }));
    };
    
    alpacaWs.onclose = () => {
      console.log('Alpaca WebSocket closed');
      socket.send(JSON.stringify({ type: 'status', message: 'Alpaca disconnected' }));
      socket.close();
    };
  };
  
  socket.onclose = () => {
    if (alpacaWs) {
      alpacaWs.close();
    }
  };
  
  return response;
});