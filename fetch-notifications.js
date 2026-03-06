const https = require('https');

async function testFetch() {
    console.log("Logging in...");
    const loginData = JSON.stringify({
        email: 'contato@victorhamber.com',
        password: 'Victor968712Vg@'
    });

    const loginReq = https.request('https://api.trajettu.com/auth/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': loginData.length
        }
    }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            const data = JSON.parse(body);
            if (!data.token) {
                console.error("Login failed:", body);
                return;
            }
            console.log("Login success! Token acquired.");

            console.log("Fetching notifications...");
            const fetchReq = https.request('https://api.trajettu.com/notifications', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${data.token}`
                }
            }, (res2) => {
                let body2 = '';
                res2.on('data', chunk => body2 += chunk);
                res2.on('end', () => {
                    console.log("NOTIFICATIONS RESPONSE:", res2.statusCode);
                    try {
                        console.log(JSON.stringify(JSON.parse(body2), null, 2));
                    } catch (e) {
                        console.log(body2);
                    }
                });
            });
            fetchReq.end();
        });
    });

    loginReq.write(loginData);
    loginReq.end();
}

testFetch();
