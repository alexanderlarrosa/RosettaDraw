<?php
/**
 * RosettaDraw — Proxy PHP para la API de Google Input Tools (Reconocimiento de Escritura)
 *
 * Este archivo debe subirse a la raíz de tu hosting (junto a index.html).
 * Actúa de puente entre el navegador del usuario y la API de Google,
 * evitando el bloqueo CORS que ocurre al llamarla directamente desde el browser.
 *
 * URL de uso: /handwriting.php
 */

// Solo aceptar método POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Method Not Allowed']);
    exit;
}

$googleUrl = 'https://inputtools.google.com/request?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8';

// Leer el cuerpo del request enviado por la app
$inputBody = file_get_contents('php://input');

// Hacer la solicitud a Google usando cURL
$ch = curl_init($googleUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $inputBody);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'Content-Length: ' . strlen($inputBody),
]);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

// Manejar errores de conexión
if ($curlError) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Error conectando con Google: ' . $curlError]);
    exit;
}

// Devolver la respuesta de Google al navegador
http_response_code($httpCode);
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
echo $response;
