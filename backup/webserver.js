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
const root_url = '/index.html';

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

// Start HTTP server for front-end website and listen/respond to requests
http.createServer((request, response) => {
  const { method, url } = request;  // Add these to the curly brackets if required { headers, method }
  let body = '';
  request.on('data', chunk => {body += `${chunk}`;})
  // This is the core logic of filtering for requested keywords 
  // in the URL to call functions in response to the request
  request.on('end', () => {
    switch(method, url) {
      case '/':
        if (method == 'POST') {
          let parsedBody = qs.decode(body);
          postMsg(parsedBody);
        }
        openUrl(root_url, response);
        console.log('Site served')
        break;
      case '/script.js':
        openUrl(url, response);
        break;
      case '/style.css':
        openUrl(url, response);
        break;
      case '/travolta.webp':
        openUrl(url, response);
        break;
      case '/getMsg':
        getMsg (response);
        break;
      default:
        response.statusCode = 404;
        response.end();
    }     
  })
  request.on('error', error => {console.error(error);})
}).listen(http_port);

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

// Find url on file system and respond to requests with said file
function openUrl(url, response) {
  const readStream = fs.createReadStream(url.substring(1));  
  readStream.on('open', () => {
    // console.log(`${url} \u001b[32mserved\u001b[0m, ${mime.getType(url.substring(1))}`);
    response.writeHead(200, { "Content-Type": mime.getType(url.substring(1)) });
    readStream.pipe(response);
  })
  readStream.on('error', error => {
    console.error(`${url} \u001b[31m ${error.code} \u001b[0m`);
    response.statusCode = 404;
    return response.end();
  })
}
// Respond with allDocs to fetch from front-end website
function getMsg (response) {
  console.log('Serving messages')
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.write(JSON.stringify(allDocs));
  response.end();
}
// Validate POST message submitted from front-end website
// and generate POST to database server for storage
function postMsg (body) {
  if (body.username !== undefined || body.message !== undefined) {
    if (body.username !== "" || body.message !== ""){
      if (!searchValue(body.username) && !searchValue(body.message)){
        var date = new Date();
        // username is shoved into _id to eliminate potential time collision when posting to the db server
        var string = `{ "_id":"${date.toISOString()};${body.username}","message":"${encodeURI(body.message)}","username":"${body.username}" }`;
        const req = http.request(postMsgOptions, (res) => {
          console.log(`post: ${res.statusCode}`);
          console.log(`  username: ${body.username}`)
          console.log(`  message: ${body.message}`)
        }); 
        req.on('error', error => {return console.error(error);})
        req.write(string);
        req.end();
      } else {
        console.log('Duplicate request made')
        console.log(`  username: ${body.username}`)
        console.log(`  message: ${body.message}`)
      }
    }
  }
  return;
}
//Search for either Username or Message values to search for duplicates
function searchValue(value) {
  var result = false
  for (i = 0; i < allDocs.total_rows; i++) {
    if (Object.values(allDocs.rows[i].doc).includes(value)) {
      result = true
    }
  }
  return result
}