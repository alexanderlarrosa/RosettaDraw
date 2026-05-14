import { fabric } from 'fabric';
import { DollarRecognizer } from './unistroke.js';

// --- UI Elements ---
const canvasContainer = document.getElementById('canvasContainer');
const statusIndicator = document.getElementById('statusIndicator');

// Buttons
const btnPencil = document.getElementById('btnPencil');
const btnSelect = document.getElementById('btnSelect');
const btnRect = document.getElementById('btnRect');
const btnCircle = document.getElementById('btnCircle');
const btnText = document.getElementById('btnText');
const btnMagic = document.getElementById('btnMagic');
const btnNew = document.getElementById('btnNew');
const btnSave = document.getElementById('btnSave');

// --- State ---
let isMagicMode = false;
let magicPaths = [];
let magicStrokeData = []; // Guardar coordenadas X, Y de cada trazo
let magicDebounceTimer = null;
const MAGIC_TIMEOUT = 2500; // 2.5 seconds

const dollar = new DollarRecognizer();

// --- Google Handwriting Recognition (gratis, sin API key) ---
async function recognizeHandwriting(strokes, language = 'es') {
  const payload = {
    options: 'enable_pre_space',
    requests: [{
      writing_guide: {
        writing_area_width: canvas.width,
        writing_area_height: canvas.height
      },
      ink: strokes, // Array de trazos: cada trazo es [[x1,x2,...],[y1,y2,...],[t1,t2,...]]
      language: language
    }]
  };

  console.log('Enviando strokes:', JSON.stringify(payload));

  const response = await fetch(
    '/api/handwriting?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    console.error('HTTP Error:', response.status, response.statusText);
    const errorText = await response.text();
    console.error('Response body:', errorText);
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  console.log('Google Handwriting Response:', JSON.stringify(data));

  // La respuesta viene como: ["SUCCESS", [["", [candidato1, candidato2, ...], ...]]]
  if (data[0] === 'SUCCESS' && data[1] && data[1][0] && data[1][0][1]) {
    return data[1][0][1]; // Array de candidatos de texto
  }
  return [];
}

// --- Initialize Fabric Canvas ---
const canvas = new fabric.Canvas('c', {
  isDrawingMode: true,
  width: canvasContainer.clientWidth,
  height: canvasContainer.clientHeight,
  backgroundColor: '#f3f4f6' // tailwind gray-100
});

// Canvas Setup
fabric.Object.prototype.transparentCorners = false;
fabric.Object.prototype.cornerColor = 'blue';
fabric.Object.prototype.cornerStyle = 'circle';

window.addEventListener('resize', () => {
  canvas.setWidth(canvasContainer.clientWidth);
  canvas.setHeight(canvasContainer.clientHeight);
  canvas.renderAll();
});

function setStatus(text, type = 'normal') {
  statusIndicator.textContent = text;
  if (type === 'magic') {
    statusIndicator.className = 'text-sm px-3 py-1 bg-purple-100 text-purple-700 rounded-full font-bold shadow-sm transition-colors';
  } else if (type === 'action') {
    statusIndicator.className = 'text-sm px-3 py-1 bg-blue-100 text-blue-700 rounded-full font-medium transition-colors';
  } else {
    statusIndicator.className = 'text-sm px-3 py-1 bg-green-100 text-green-700 rounded-full font-medium transition-colors';
  }
}

setStatus('Lápiz Mágico preparado.', 'magic');

function updateActiveButton(activeBtn) {
  const tools = [btnPencil, btnSelect, btnMagic];
  tools.forEach(btn => {
    if (btn === btnMagic) {
      if (btn === activeBtn) btn.classList.add('ring-4', 'ring-purple-300');
      else btn.classList.remove('ring-4', 'ring-purple-300');
    } else {
      if (btn === activeBtn) {
        btn.classList.add('bg-white', 'shadow-sm', 'text-blue-600');
        btn.classList.remove('text-gray-600', 'hover:bg-gray-200');
      } else {
        btn.classList.remove('bg-white', 'shadow-sm', 'text-blue-600');
        btn.classList.add('text-gray-600', 'hover:bg-gray-200');
      }
    }
  });
}

function getCenter() {
  return { left: canvas.width / 2, top: canvas.height / 2 };
}

// --- Standard Tools Logic ---
btnPencil.addEventListener('click', () => {
  isMagicMode = false;
  canvas.isDrawingMode = true;
  updateActiveButton(btnPencil);
  setStatus('Lápiz Normal', 'action');
  canvas.freeDrawingBrush.color = '#000000';
  canvas.freeDrawingBrush.width = 3;
});

btnSelect.addEventListener('click', () => {
  isMagicMode = false;
  canvas.isDrawingMode = false;
  updateActiveButton(btnSelect);
  setStatus('Modo Selección', 'action');
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (canvas.getActiveObject() && canvas.getActiveObject().isEditing) return;
    const activeObjects = canvas.getActiveObjects();
    if (activeObjects.length) {
      canvas.discardActiveObject();
      activeObjects.forEach((obj) => canvas.remove(obj));
      canvas.renderAll();
    }
  }
});

btnRect.addEventListener('click', () => {
  const center = getCenter();
  const rect = new fabric.Rect({
    left: center.left, top: center.top, fill: 'transparent',
    stroke: 'black', strokeWidth: 3, width: 100, height: 100, originX: 'center', originY: 'center'
  });
  canvas.add(rect); canvas.setActiveObject(rect);
});

btnCircle.addEventListener('click', () => {
  const center = getCenter();
  const circle = new fabric.Circle({
    left: center.left, top: center.top, fill: 'transparent',
    stroke: 'black', strokeWidth: 3, radius: 50, originX: 'center', originY: 'center'
  });
  canvas.add(circle); canvas.setActiveObject(circle);
});

btnText.addEventListener('click', () => {
  const center = getCenter();
  const text = new fabric.IText('Texto...', {
    left: center.left, top: center.top, fontFamily: 'sans-serif', fill: 'black',
    fontSize: 32, originX: 'center', originY: 'center'
  });
  canvas.add(text); canvas.setActiveObject(text); text.enterEditing(); text.selectAll();
});

btnNew.addEventListener('click', () => {
  if(confirm('¿Estás seguro que deseas limpiar el lienzo?')) {
    canvas.clear(); canvas.backgroundColor = '#f3f4f6'; canvas.renderAll();
    setStatus('Lienzo limpio');
  }
});

btnSave.addEventListener('click', () => {
  const dataURL = canvas.toDataURL({ format: 'png', quality: 1 });
  const link = document.createElement('a'); link.download = 'mi-dibujo.png'; link.href = dataURL;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
});

// --- Magic Pen Logic ---
btnMagic.addEventListener('click', () => {
  isMagicMode = true;
  canvas.isDrawingMode = true;
  updateActiveButton(btnMagic);
  setStatus('Lápiz Mágico Activado', 'magic');
  canvas.freeDrawingBrush.color = '#8b5cf6';
  canvas.freeDrawingBrush.width = 4;
});

// Capturar puntos del trazo en tiempo real para Google Handwriting
let currentStrokeX = [];
let currentStrokeY = [];
let currentStrokeT = [];
let strokeStartTime = 0;

canvas.on('mouse:down', (e) => {
  if (!isMagicMode) return;
  if (magicDebounceTimer) clearTimeout(magicDebounceTimer);
  
  // Iniciar captura de trazo
  strokeStartTime = Date.now();
  currentStrokeX = [];
  currentStrokeY = [];
  currentStrokeT = [];
  
  const pointer = canvas.getPointer(e.e);
  currentStrokeX.push(Math.round(pointer.x));
  currentStrokeY.push(Math.round(pointer.y));
  currentStrokeT.push(0);
});

canvas.on('mouse:move', (e) => {
  if (!isMagicMode || currentStrokeX.length === 0) return;
  if (!e.e.buttons) return; // Solo si se está presionando el botón
  
  const pointer = canvas.getPointer(e.e);
  currentStrokeX.push(Math.round(pointer.x));
  currentStrokeY.push(Math.round(pointer.y));
  currentStrokeT.push(Date.now() - strokeStartTime);
});

canvas.on('mouse:up', () => {
  if (!isMagicMode || currentStrokeX.length === 0) return;
  
  // Guardar el trazo completado
  if (currentStrokeX.length > 1) {
    magicStrokeData.push([currentStrokeX, currentStrokeY, currentStrokeT]);
  }
  
  currentStrokeX = [];
  currentStrokeY = [];
  currentStrokeT = [];
});

canvas.on('path:created', (e) => {
  if (!isMagicMode) return;
  magicPaths.push(e.path);
  setStatus('Dibujando...', 'magic');
  if (magicDebounceTimer) clearTimeout(magicDebounceTimer);
  magicDebounceTimer = setTimeout(() => { processMagicPaths(); }, MAGIC_TIMEOUT);
});

async function processMagicPaths() {
  if (magicPaths.length === 0) return;
  setStatus('Analizando trazos...', 'magic');

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  magicPaths.forEach(p => {
    const bound = p.getBoundingRect();
    if (bound.left < minX) minX = bound.left;
    if (bound.top < minY) minY = bound.top;
    if (bound.left + bound.width > maxX) maxX = bound.left + bound.width;
    if (bound.top + bound.height > maxY) maxY = bound.top + bound.height;
  });

  const bBox = { left: minX, top: minY, width: maxX - minX, height: maxY - minY };

  // 1. RECONOCIMIENTO DE FORMAS ($1 Unistroke)
  let newShape = null;
  if (magicPaths.length === 1 && bBox.width > 20 && bBox.height > 20) {
    const p = magicPaths[0];
    const points = [];
    p.path.forEach(seg => {
      if (seg.length >= 3) points.push({ x: seg[seg.length - 2], y: seg[seg.length - 1] });
    });
    
    // Algoritmo evalúa la forma
    const result = dollar.recognize(points);
    console.log("$1 Recognizer:", result);
    
    // Si la coincidencia es alta (ej. > 82%), es una forma
    if (result.score > 0.82 && result.name !== 'unknown') {
      const radius = Math.max(bBox.width, bBox.height) / 2;
      
      if (result.name === 'circle') {
        newShape = new fabric.Circle({
          left: bBox.left + bBox.width / 2, top: bBox.top + bBox.height / 2,
          radius: radius, fill: 'transparent', stroke: p.stroke, strokeWidth: p.strokeWidth, originX: 'center', originY: 'center'
        });
      } else if (result.name === 'rectangle') {
        newShape = new fabric.Rect({
          left: bBox.left + bBox.width / 2, top: bBox.top + bBox.height / 2,
          width: bBox.width, height: bBox.height, fill: 'transparent', stroke: p.stroke, strokeWidth: p.strokeWidth, originX: 'center', originY: 'center'
        });
      } else if (result.name === 'triangle') {
        newShape = new fabric.Triangle({
          left: bBox.left + bBox.width / 2, top: bBox.top + bBox.height / 2,
          width: bBox.width, height: bBox.height, fill: 'transparent', stroke: p.stroke, strokeWidth: p.strokeWidth, originX: 'center', originY: 'center'
        });
      }
    }
  }

  // Si detectó una forma, reemplaza y termina
  if (newShape) {
    canvas.remove(magicPaths[0]);
    canvas.add(newShape);
    setStatus(`Forma detectada: ${newShape.type}`, 'magic');
    resetMagicMode();
    return;
  }

  // 2. RECONOCIMIENTO DE TEXTO (Google Handwriting API)
  try {
    if (magicStrokeData.length === 0) {
      setStatus('No se capturaron trazos válidos', 'magic');
      resetMagicMode();
      return;
    }

    setStatus('Reconociendo texto...', 'magic');
    
    const candidates = await recognizeHandwriting(magicStrokeData);
    console.log("Candidatos:", candidates);

    if (candidates.length > 0) {
      const bestText = candidates[0].trim();
      if (bestText.length > 0) {
        const textObj = new fabric.IText(bestText, {
          left: bBox.left, top: bBox.top, fontFamily: 'sans-serif',
          fill: '#8b5cf6', fontSize: Math.max(24, bBox.height * 0.8)
        });
        magicPaths.forEach(p => canvas.remove(p));
        canvas.add(textObj);
        canvas.setActiveObject(textObj);
        setStatus('Texto detectado: ' + bestText, 'magic');
      } else {
        setStatus('No se entendió la palabra', 'magic');
      }
    } else {
      setStatus('No se pudo reconocer. Intenta escribir más claro.', 'magic');
    }
  } catch (error) {
    console.error('Handwriting Error:', error);
    console.error('Stack:', error.stack);
    setStatus('Error: ' + error.message, 'magic');
  }

  resetMagicMode();
}

function resetMagicMode() {
  magicPaths = [];
  magicStrokeData = [];
  magicDebounceTimer = null;
  setTimeout(() => {
    if (isMagicMode && magicPaths.length === 0) {
      setStatus('Lápiz Mágico Listo', 'magic');
    }
  }, 2000);
}
