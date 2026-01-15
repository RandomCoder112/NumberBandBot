import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
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
    
    console.log(`WebSocket upgrade successful for ticker: ${ticker}`);
  
  const apiKey = Deno.env.get('ALPACA_API_KEY');
  const apiSecret = Deno.env.get('ALPACA_API_SECRET');
  
  if (!apiKey || !apiSecret) {
    console.error('Missing Alpaca credentials');
    socket.close(1011, 'Missing Alpaca credentials');
    return response;
  }
  
  console.log('Alpaca credentials found');
  
  let alpacaWs = null;
  
  socket.onopen = () => {
    console.log('Client connected, connecting to Alpaca...');

    // Connect to Alpaca WebSocket
    alpacaWs = new WebSocket('wss://stream.data.alpaca.markets/v2/iex');

    alpacaWs.onopen = () => {
      console.log('Connected to Alpaca, authenticating...');
      // Authenticate - subscribe ONLY after receiving authenticated confirmation
      alpacaWs.send(JSON.stringify({
        action: 'auth',
        key: apiKey,
        secret: apiSecret
      }));
    };

    alpacaWs.onmessage = (event) => {
      try {
        const messages = JSON.parse(event.data);
        console.log('Alpaca message:', messages);

        // Alpaca always sends messages as arrays
        if (Array.isArray(messages)) {
          for (const msg of messages) {
            // Check for authentication success FIRST
            if (msg.msg === 'authenticated') {
              console.log('Authenticated with Alpaca, subscribing to', ticker);
              // NOW subscribe after authentication
              alpacaWs.send(JSON.stringify({
                action: 'subscribe',
                quotes: [ticker],
                trades: [ticker]
              }));
              socket.send(JSON.stringify({ type: 'status', message: 'Authenticated with Alpaca' }));
            } else if (msg.T === 'q') {
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
            } else if (msg.T === 'subscription') {
              console.log('Subscription confirmed:', msg);
              socket.send(JSON.stringify({ type: 'status', message: `Subscribed to ${ticker}` }));
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
    console.log('Client WebSocket closed');
    if (alpacaWs) {
      alpacaWs.close();
    }
  };
  
  socket.onerror = (err) => {
    console.error('Client WebSocket error:', err);
  };
  
  return response;
  } catch (error) {
    console.error('Function error:', error);
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
});