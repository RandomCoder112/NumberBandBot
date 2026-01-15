const ALPACA_API_KEY = Deno.env.get("ALPACA_API_KEY");
const ALPACA_API_SECRET = Deno.env.get("ALPACA_API_SECRET");
const ALPACA_BASE_URL = "https://paper-api.alpaca.markets";

Deno.serve(async (req) => {
    try {
        // Removed Base44 authentication - function now runs independently
        // You can add your own authentication logic here if needed

        const { action, ticker, quantity, orderId } = await req.json();

        // Place order
        if (action === 'placeOrder') {
            const response = await fetch(`${ALPACA_BASE_URL}/v2/orders`, {
                method: 'POST',
                headers: {
                    'APCA-API-KEY-ID': ALPACA_API_KEY,
                    'APCA-API-SECRET-KEY': ALPACA_API_SECRET,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    symbol: ticker,
                    qty: quantity,
                    side: 'buy',
                    type: 'market',
                    time_in_force: 'day'
                })
            });

            const order = await response.json();
            return Response.json({ success: true, order });
        }

        // Close position
        if (action === 'closePosition') {
            const response = await fetch(`${ALPACA_BASE_URL}/v2/orders`, {
                method: 'POST',
                headers: {
                    'APCA-API-KEY-ID': ALPACA_API_KEY,
                    'APCA-API-SECRET-KEY': ALPACA_API_SECRET,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    symbol: ticker,
                    qty: quantity,
                    side: 'sell',
                    type: 'market',
                    time_in_force: 'day'
                })
            });

            const order = await response.json();
            return Response.json({ success: true, order });
        }

        // Get account info
        if (action === 'getAccount') {
            const response = await fetch(`${ALPACA_BASE_URL}/v2/account`, {
                headers: {
                    'APCA-API-KEY-ID': ALPACA_API_KEY,
                    'APCA-API-SECRET-KEY': ALPACA_API_SECRET
                }
            });

            const account = await response.json();
            return Response.json({ success: true, account });
        }

        // Get latest quote
        if (action === 'getQuote') {
            const response = await fetch(
                `${ALPACA_BASE_URL}/v2/stocks/${ticker}/quotes/latest?feed=iex`,
                {
                    headers: {
                        'APCA-API-KEY-ID': ALPACA_API_KEY,
                        'APCA-API-SECRET-KEY': ALPACA_API_SECRET
                    }
                }
            );

            const data = await response.json();
            return Response.json({ success: true, quote: data.quote });
        }

        return Response.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});