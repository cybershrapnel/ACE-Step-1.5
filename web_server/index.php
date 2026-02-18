<?php
// PHP 5.2-compatible reverse proxy for an upstream (FastAPI proxy on :80)
//This is meant to be hosted on a seperate server, I host this on a shared godaddy server and it proxies my proxy to my actual rest-api server.
//run the proxy pyton server to connect, will need the htaccess file as well.

// CHANGE THIS:
$UPSTREAM = 'http://*.*.*.*'; // or http://YOUR_PUBLIC_HOST:8080 change to your server ip

// --- get upstream path from rewrite param ---
$u = isset($_GET['u']) ? $_GET['u'] : '/';
if ($u === '' || $u === null) $u = '/';
if ($u[0] !== '/') $u = '/' . $u;

// --- rebuild query string excluding "u" ---
$query = '';
if (!empty($_SERVER['QUERY_STRING'])) {
    $params = array();
    parse_str($_SERVER['QUERY_STRING'], $params);
    if (isset($params['u'])) unset($params['u']);
    if (!empty($params)) {
        $query = http_build_query($params);
    }
}

$target = rtrim($UPSTREAM, '/') . $u;
if ($query !== '') {
    $target .= (strpos($target, '?') === false ? '?' : '&') . $query;
}

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';

// --- collect request headers ---
$reqHeaders = array();
if (function_exists('getallheaders')) {
    $h = getallheaders();
    if (is_array($h)) {
        foreach ($h as $k => $v) $reqHeaders[$k] = $v;
    }
} else {
    // fallback for some SAPIs
    foreach ($_SERVER as $k => $v) {
        if (substr($k, 0, 5) === 'HTTP_') {
            $name = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($k, 5)))));
            $reqHeaders[$name] = $v;
        }
    }
}

$hopByHop = array(
    'Connection' => 1,
    'Keep-Alive' => 1,
    'Proxy-Authenticate' => 1,
    'Proxy-Authorization' => 1,
    'TE' => 1,
    'Trailers' => 1,
    'Transfer-Encoding' => 1,
    'Upgrade' => 1,
    'Host' => 1,
    'Content-Length' => 1
);

// Build headers for cURL
$outHeaders = array();
foreach ($reqHeaders as $k => $v) {
    $kk = trim($k);
    if ($kk === '') continue;

    // drop hop-by-hop headers + Accept-Encoding (prevents gzip/chunk weirdness)
    if (isset($hopByHop[$kk])) continue;
    if (strcasecmp($kk, 'Accept-Encoding') === 0) continue;

    $outHeaders[] = $kk . ': ' . $v;
}

// Read body for non-GET/HEAD
$body = '';
if ($method !== 'GET' && $method !== 'HEAD') {
    $body = file_get_contents('php://input');
}

$ch = curl_init($target);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
curl_setopt($ch, CURLOPT_HTTPHEADER, $outHeaders);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
curl_setopt($ch, CURLOPT_TIMEOUT, 300);
curl_setopt($ch, CURLOPT_HEADER, false);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);

// Don’t follow redirects; just pass Location through if upstream sends it.
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);

// Send body if present
if ($body !== '') {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

// Stream response headers back to client
curl_setopt($ch, CURLOPT_HEADERFUNCTION, 'proxyHeaderCb');

// Stream response body back to client
curl_setopt($ch, CURLOPT_WRITEFUNCTION, 'proxyWriteCb');

$GLOBALS['_proxy_sent_status'] = false;
$GLOBALS['_proxy_sent_headers'] = array();

$ok = curl_exec($ch);

if ($ok === false) {
    $err = curl_error($ch);
    $code = curl_errno($ch);
    if (!headers_sent()) {
        header('Content-Type: application/json');
        header('HTTP/1.1 502 Bad Gateway');
    }
    echo '{"error":"Upstream request failed","curl_errno":' . intval($code) . ',"message":"' . addslashes($err) . '"}';
}

curl_close($ch);
exit;

// --- callbacks ---
function proxyHeaderCb($ch, $headerLine) {
    $line = trim($headerLine);
    $len = strlen($headerLine);
    if ($line === '') return $len;

    // Status line
    if (preg_match('#^HTTP/\S+\s+(\d+)\s*(.*)$#i', $line, $m)) {
        $code = intval($m[1]);
        $msg  = isset($m[2]) && $m[2] !== '' ? $m[2] : '';
        // Send status
        header('HTTP/1.1 ' . $code . ($msg !== '' ? ' ' . $msg : ''), true, $code);
        $GLOBALS['_proxy_sent_status'] = true;
        // reset header de-dupe set for this response
        $GLOBALS['_proxy_sent_headers'] = array();
        return $len;
    }

    // Split header
    $pos = strpos($line, ':');
    if ($pos === false) return $len;
    $name = trim(substr($line, 0, $pos));
    $value = trim(substr($line, $pos + 1));

    if ($name === '') return $len;

    // Drop hop-by-hop / problematic headers
    if (!strcasecmp($name, 'Transfer-Encoding')) return $len;
    if (!strcasecmp($name, 'Content-Length')) return $len;
    if (!strcasecmp($name, 'Connection')) return $len;
    if (!strcasecmp($name, 'Keep-Alive')) return $len;

    // Prevent duplicates of some headers
    $key = strtolower($name);
    if (!isset($GLOBALS['_proxy_sent_headers'][$key])) {
        header($name . ': ' . $value, true);
        $GLOBALS['_proxy_sent_headers'][$key] = true;
    } else {
        // allow multiple Set-Cookie, etc.
        if (!strcasecmp($name, 'Set-Cookie')) {
            header($name . ': ' . $value, false);
        }
    }

    return $len;
}

function proxyWriteCb($ch, $data) {
    echo $data;
    if (function_exists('flush')) @flush();
    return strlen($data);
}
