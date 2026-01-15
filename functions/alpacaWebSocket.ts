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
    // Connect to Alpaca WebSocket
    alpacaWs = new WebSocket('wss://stream.data.alpaca.markets/v2/iex');
    
    alpacaWs.onopen = () => {
      // Authenticate
      alpacaWs.send(JSON.stringify({
        action: 'auth',
        key: apiKey,
        secret: apiSecret
      }));
      
      // Subscribe to quotes and trades
      setTimeout(() => {
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
        
        // Forward all messages to client
        if (Array.isArray(data)) {
          for (const msg of data) {
            if (msg.T === 'q') {
              // Quote message
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
              socket.send(JSON.stringify({
                type: 'trade',
                symbol: msg.S,
                price: msg.p,
                size: msg.s,
                timestamp: msg.t
              }));
            }
          }
        } else if (data[0]?.msg === 'authenticated') {
          socket.send(JSON.stringify({ type: 'status', message: 'Connected to Alpaca' }));
        }
      } catch (err) {
        console.error('Parse error:', err);
      }
    };
    
    alpacaWs.onerror = (error) => {
      socket.send(JSON.stringify({ type: 'error', message: 'Alpaca connection error' }));
    };
    
    alpacaWs.onclose = () => {
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