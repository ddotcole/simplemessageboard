// Import modules as follows...
const http = require('http');
const fs = require('fs');
const mime = require('mime');
const qs = require('querystring');

// Define magic numbers
const db_auth = 'admin:0041';
const db_server = '127.0.0.1';
const db_port = 5984;
const http_port = 8080;

// Define options for generating HTTP requests
const agent = new http.Agent({
  keepAlive: true,
  maxSockets: 1
});
const changesMsgOptions = {
  agent: agent,
  auth: db_auth,
  hostname: db_server,
  port: db_port,
  path: '/messages/_changes?feed=continuous&since=now&include_docs=true&heartbeat=30000',
  headers: {'Content-Type': 'application/json', 'Connection': 'Keep-Alive'}
};
const getMsgOptions = {
  auth: db_auth,
  hostname: db_server,
  port: db_port,
  path: '/messages/_all_docs?include_docs=true',
  method: 'GET',
  headers: {'Content-Type': 'application/json'}
};
const postMsgOptions = {
  auth: db_auth,
  hostname: db_server,
  port: db_port,
  path: '/messages',
  method: 'POST',
  headers: {'Content-Type': 'application/json'}
};

// Create global allDocs variable to cache documents from database 
var allDocs = (() => {
  const req = http.request(getMsgOptions, (res) => {
    let body = "";
    console.log(`allDocs: ${res.statusCode}`);
    res.on('data', chunk => {body += `${chunk}`;})
    res.on('end', () => {
      allDocs = JSON.parse(body);
    })
  }); 
  req.on('error', error => {console.error(error);})
  req.end();
})()

// Find url on file system and respond to requests with said file
function openUrl(url, response) {
  const readStream = fs.createReadStream(url.substring(1));  
  readStream.on('open', () => {
    response.writeHead(200, { "Content-Type": mime.getType(url.substring(1)), "Cache-Control": "max-age=31536000" });
    readStream.pipe(response);
    console.log(`\u001b[32mServed\u001b[0m: ${url}`)
  })
  readStream.on('error', error => {
    response.statusCode = 404;
    response.end();
    console.error(`\u001b[31mDenied\u001b[0m: ${url} \u001b[33m ${error.code} \u001b[0m`);
  })
}
// Respond with allDocs to fetch from front-end website
function getMsg (response) {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.write(JSON.stringify(allDocs));
  response.end();
}
/* 
Validate POST message submitted from front-end website
and generate POST to couch server for storage.  Next the
couch server sends out a changes message which is received 
and merged into global allDocs variable using http.get shown 
above.  After this point the users website shall reload, 
requesting allDocs with the updated messages.
*/
function postMsg (body, response) {
  if (body.username !== undefined || body.message !== undefined) {
    if (body.username !== "" || body.message !== ""){
      if (!contains(body.username, body.message)){
        var date = new Date();
        // username is shoved into _id to eliminate potential time collision when posting to the db server
        var string = `{ "_id":"${date.toISOString()};${body.username}","message":"${encodeURI(body.message)}","username":"${body.username}" }`;
        const req = http.request(postMsgOptions, (res) => {
          response.write(`<script>alert("New message added");location = location;</script>`)
          response.end();
          console.log(`\u001b[36mAdded\u001b[0m: ${res.statusCode}`);
          console.log(`  username: ${body.username}`)
          console.log(`  message: ${body.message}`)
        }); 
        req.on('error', error => {return console.error(error);})
        req.write(string);
        req.end();
      } else {
        response.write(`<script>alert("Duplicate message not added");location = location;</script>`)
        response.end();
        console.log('\u001b[36mDuplicate\u001b[0m:')
        console.log(`  username: ${body.username}`)
        console.log(`  message: ${body.message}`)
      }
    }
  }
}
//Check for duplicate message in allDocs before POSTing to couch DB
function contains(username, message) {
  let result = false
  for (const i in allDocs.rows)
  {
    if(allDocs.rows[i].doc.username === username && decodeURI(allDocs.rows[i].doc.message) === message){result = true;}
  }
  return result;
}

// Connect to changes feed from database server and update allDocs with changes
http.get(changesMsgOptions, (res) => {
  let body = "";
  console.log(`changes: ${res.statusCode}`);
  res.on('data', chunk => {
    body = `${chunk}`;
    let changes = body.replace(/(\n)/gm,""); // Filter out database heartbeat (newline) so JSON.parse will parse correctly
    if(changes !== ''){ // changes should be empty if no change was sent
      if(changes.substring(1, 6) === '"seq"'){ // Make sure first key is "seq" so as to filter for correct date
        allDocs.rows.push(JSON.parse(changes));
        allDocs.total_rows = allDocs.rows.length; // total_rows doesn't update correctly after push so make it equal to rows.length which does
      }
    }
  })
  res.on('error', error => {console.error(error);})
}).on('socket', (socket) => {socket.on("close", () => {console.log("socket has been closed");});  
});

// Start HTTP server for front-end website and listen/respond to requests
http.createServer((request, response) => {
  let { method, url } = request;  // Add these to the curly brackets if required { headers, method }
  let body = '';
  request.on('data', chunk => {body += `${chunk}`;})
  // This is the core logic of filtering for requested keywords 
  // in the URL to call functions in response to the request
  request.on('end', () => {
    if(method === 'GET' && url.charAt(0) === '/' && url !== '/getMsg'){
      if(method === 'GET' && url === "/"){url = '/index.html';}
      openUrl(url, response);
    }else if(method === 'GET' && url === '/getMsg'){
      getMsg (response);
      console.log(`\u001b[32mServed\u001b[0m: ${url}`)
    }else if(method === 'POST' && url === '/'){
      postMsg(qs.decode(body), response)
    }else{
      response.statusCode = 404;
      response.end();
      console.log(`\u001b[31mDenied\u001b[0m: ${url}`)
    }  
  })
  request.on('error', error => {console.error(error);})
}).listen(http_port,() => {console.log(`HTTP Web server listening on port ${http_port}`)});