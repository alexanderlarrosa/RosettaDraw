import { fabric } from 'fabric';
import 'fabric-eraser-brush';
import { DollarRecognizer } from './unistroke.js';

// --- UI Elements ---
const canvasContainer = document.getElementById('canvasContainer');
const statusIndicator = document.getElementById('statusIndicator');

// Buttons
const btnPencil = document.getElementById('btnPencil');
const btnEraser = document.getElementById('btnEraser');
const btnSelect = document.getElementById('btnSelect');
const btnRect = document.getElementById('btnRect');
const btnCircle = document.getElementById('btnCircle');
const btnTriangle = document.getElementById('btnTriangle');
const btnLine = document.getElementById('btnLine');
const btnArrow = document.getElementById('btnArrow');
const btnText = document.getElementById('btnText');
const btnMagic = document.getElementById('btnMagic');
const btnResetView = document.getElementById('btnResetView');
const btnNew = document.getElementById('btnNew');
const btnSaveProject = document.getElementById('btnSaveProject');
const btnSave = document.getElementById('btnSave');
const btnImport = document.getElementById('btnImport');
const fileInput = document.getElementById('fileInput');
const btnUndo = document.getElementById('btnUndo');
const btnRedo = document.getElementById('btnRedo');
const gridBackground = document.getElementById('gridBackground');

// Properties Toolbar
const strokeColorInput = document.getElementById('strokeColor');
const fillColorInput = document.getElementById('fillColor');
const fillEnabledInput = document.getElementById('fillEnabled');
const strokeWidthInput = document.getElementById('strokeWidth');
const strokeWidthVal = document.getElementById('strokeWidthVal');
const strokeWidthContainer = document.getElementById('strokeWidthContainer');
const eraserWidthInput = document.getElementById('eraserWidth');
const eraserWidthVal = document.getElementById('eraserWidthVal');
const eraserWidthContainer = document.getElementById('eraserWidthContainer');
const textSizeInput = document.getElementById('textSize');
const textSizeVal = document.getElementById('textSizeVal');
const fixedTextSizeInput = document.getElementById('fixedTextSize');

// --- State ---
let currentTool = 'pencil'; // pencil, select, magic, rect, circle, triangle, line, arrow, text
let currentArrowStyle = 'normal'; // normal, triangle-hollow, triangle-filled, diamond-hollow, diamond-filled
let isMagicMode = false;
let magicPaths = [];
let magicStrokeData = []; // Guardar coordenadas X, Y de cada trazo
let magicDebounceTimer = null;
const MAGIC_TIMEOUT = 2500; // 2.5 seconds

// State for shape drawing
let isDrawingShape = false;
let origX = 0;
let origY = 0;
let activeShape = null;

// History State
let undoStack = [];
let redoStack = [];
let isHistoryProcessing = false;

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
  backgroundColor: null,
  fireMiddleClick: true
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

function updateBackground() {
  if (!gridBackground) return;
  const vpt = canvas.viewportTransform;
  const zoom = canvas.getZoom();
  gridBackground.style.backgroundPosition = `${vpt[4]}px ${vpt[5]}px`;
  gridBackground.style.backgroundSize = `${20 * zoom}px ${20 * zoom}px`;
}

// --- Zoom & Pan Logic ---
let isPanning = false;
let lastPosX = 0;
let lastPosY = 0;

canvas.on('mouse:wheel', function(opt) {
  var delta = opt.e.deltaY;
  var zoom = canvas.getZoom();
  zoom *= 0.999 ** delta;
  if (zoom > 20) zoom = 20;
  if (zoom < 0.05) zoom = 0.05;
  canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
  opt.e.preventDefault();
  opt.e.stopPropagation();
  updateBackground();
});

// We modify mouse:down/move/up for panning
// These are added as separate listeners to not interfere with drawing tools.
canvas.on('mouse:down', function(opt) {
  var evt = opt.e;
  if (evt.altKey || evt.button === 1 || evt.button === 4) { // 1 is middle click in standard, sometimes 4 in some browsers
    if (evt.button === 1 || evt.button === 4) evt.preventDefault();
    isPanning = true;
    canvas.isDrawingMode = false;
    canvas.selection = false;
    canvas.defaultCursor = 'grab';
    lastPosX = evt.clientX;
    lastPosY = evt.clientY;
  }
});

canvas.on('mouse:move', function(opt) {
  if (isPanning) {
    var e = opt.e;
    var vpt = canvas.viewportTransform;
    vpt[4] += e.clientX - lastPosX;
    vpt[5] += e.clientY - lastPosY;
    canvas.requestRenderAll();
    lastPosX = e.clientX;
    lastPosY = e.clientY;
    updateBackground();
  }
});

canvas.on('mouse:up', function(opt) {
  if (isPanning) {
    canvas.setViewportTransform(canvas.viewportTransform);
    isPanning = false;
    // Restore tools
    setTool(currentTool, document.querySelector('.active-tool-btn') || btnPencil, currentTool !== 'select' && currentTool !== 'rect' && currentTool !== 'circle' && currentTool !== 'triangle' && currentTool !== 'line' && currentTool !== 'arrow' && currentTool !== 'text');
  }
});

function updateActiveButton(activeBtn) {
  const tools = [btnPencil, btnEraser, btnSelect, btnMagic, btnRect, btnCircle, btnTriangle, btnLine, btnArrow, btnText];
  tools.forEach(btn => {
    if (btn === btnMagic) {
      if (btn === activeBtn) btn.classList.add('ring-4', 'ring-purple-500/50');
      else btn.classList.remove('ring-4', 'ring-purple-500/50');
    } else {
      if (btn === activeBtn) {
        btn.classList.add('bg-white/10', 'text-white', 'shadow-sm');
        btn.classList.remove('text-zinc-400', 'hover:text-white', 'hover:bg-white/10');
      } else {
        btn.classList.remove('bg-white/10', 'text-white', 'shadow-sm');
        btn.classList.add('text-zinc-400', 'hover:text-white', 'hover:bg-white/10');
      }
    }
  });
}

function updateEraserCursor() {
  const size = parseInt(eraserWidthInput.value, 10);
  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size/2}" cy="${size/2}" r="${size/2 - 1}" fill="rgba(0,0,0,0.1)" stroke="black" stroke-width="1"/></svg>`;
  const encoded = encodeURIComponent(svg);
  const cursorUrl = `url("data:image/svg+xml;utf8,${encoded}") ${size/2} ${size/2}, crosshair`;
  canvas.freeDrawingCursor = cursorUrl;
  canvas.defaultCursor = cursorUrl;
}

function setTool(toolName, btnElement, drawingMode = false) {
  currentTool = toolName;
  isMagicMode = toolName === 'magic';
  canvas.isDrawingMode = drawingMode;
  
  // Deshabilitar la selección libre de objetos y la interacción al dibujar
  canvas.selection = toolName === 'select';
  canvas.skipTargetFind = toolName !== 'select';
  
  // Mostrar barra de goma o barra de trazo
  if (toolName === 'eraser') {
    strokeWidthContainer.classList.add('hidden');
    strokeWidthContainer.classList.remove('flex');
    eraserWidthContainer.classList.add('flex');
    eraserWidthContainer.classList.remove('hidden');
  } else {
    eraserWidthContainer.classList.add('hidden');
    eraserWidthContainer.classList.remove('flex');
    strokeWidthContainer.classList.add('flex');
    strokeWidthContainer.classList.remove('hidden');
  }

  // Cambiar el cursor
  if (['rect', 'circle', 'triangle', 'line', 'arrow', 'text'].includes(toolName)) {
    canvas.defaultCursor = 'crosshair';
    canvas.freeDrawingCursor = 'crosshair';
  } else if (toolName === 'eraser') {
    updateEraserCursor();
  } else if (toolName === 'pencil') {
    canvas.freeDrawingCursor = 'crosshair';
    canvas.defaultCursor = 'default';
  } else {
    canvas.freeDrawingCursor = 'crosshair';
    canvas.defaultCursor = 'default';
  }

  // Si pasamos a dibujar formas, deseleccionamos lo que esté activo
  if (toolName !== 'select') {
    canvas.discardActiveObject();
    canvas.renderAll();
  }

  updateActiveButton(btnElement);
}

function getCenter() {
  return { left: canvas.width / 2, top: canvas.height / 2 };
}

// --- Standard Tools Logic ---
btnPencil.addEventListener('click', () => {
  setTool('pencil', btnPencil, true);
  setStatus('Lápiz Normal', 'action');
  canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
  canvas.freeDrawingBrush.color = strokeColorInput.value;
  canvas.freeDrawingBrush.width = parseInt(strokeWidthInput.value, 10);
});

btnEraser.addEventListener('click', () => {
  setTool('eraser', btnEraser, true);
  setStatus('Goma de Borrar (Borrado Vectorial Permanente)', 'action');
  canvas.freeDrawingBrush = new fabric.EraserBrush(canvas);
  canvas.freeDrawingBrush.width = parseInt(eraserWidthInput.value, 10);
});

btnSelect.addEventListener('click', () => {
  setTool('select', btnSelect, false);
  setStatus('Modo Selección', 'action');
});

// Botones de Formas Geomátricas
btnRect.addEventListener('click', () => {
  setTool('rect', btnRect, false);
  setStatus('Dibujar Rectángulo', 'action');
});

btnCircle.addEventListener('click', () => {
  setTool('circle', btnCircle, false);
  setStatus('Dibujar Círculo', 'action');
});

btnTriangle.addEventListener('click', () => {
  setTool('triangle', btnTriangle, false);
  setStatus('Dibujar Triángulo', 'action');
});

btnLine.addEventListener('click', () => {
  setTool('line', btnLine, false);
  setStatus('Dibujar Línea', 'action');
});

const arrowMenu = document.getElementById('arrowMenu');
const iconArrow = document.getElementById('iconArrow');
let arrowPressTimer;
let arrowMenuOpen = false;

function closeArrowMenu() {
  arrowMenu.classList.add('hidden');
  arrowMenu.classList.remove('flex');
  arrowMenuOpen = false;
}

btnArrow.addEventListener('mousedown', () => {
  if (arrowMenuOpen) {
    closeArrowMenu();
    return;
  }
  arrowPressTimer = setTimeout(() => {
    arrowMenu.classList.remove('hidden');
    arrowMenu.classList.add('flex');
    arrowMenuOpen = true;
  }, 500);
});

btnArrow.addEventListener('mouseup', () => {
  clearTimeout(arrowPressTimer);
  if (!arrowMenuOpen) {
    setTool('arrow', btnArrow, false);
    setStatus('Dibujar Flecha', 'action');
  }
});

btnArrow.addEventListener('mouseleave', () => {
  clearTimeout(arrowPressTimer);
});

// Cerrar el menú si se hace click fuera de él
document.addEventListener('click', (e) => {
  if (arrowMenuOpen && !arrowMenu.contains(e.target) && e.target !== btnArrow && !btnArrow.contains(e.target)) {
    closeArrowMenu();
  }
});

document.querySelectorAll('.arrow-style-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    currentArrowStyle = btn.dataset.style;
    iconArrow.innerHTML = btn.querySelector('svg').innerHTML;
    closeArrowMenu();
    setTool('arrow', btnArrow, false);
    setStatus('Dibujar Flecha', 'action');
  });
});

btnText.addEventListener('click', () => {
  setTool('text', btnText, false);
  setStatus('Escribir Texto', 'action');
});

window.addEventListener('keydown', (e) => {
  // Ignorar si estamos escribiendo en un input o textbox activo
  if (e.target.tagName === 'INPUT' || (canvas.getActiveObject() && canvas.getActiveObject().isEditing)) return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    const activeObjects = canvas.getActiveObjects();
    if (activeObjects.length) {
      canvas.discardActiveObject();
      activeObjects.forEach((obj) => canvas.remove(obj));
      canvas.renderAll();
    }
  } else if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') {
      e.preventDefault();
      undo();
    } else if (e.key === 'y') {
      e.preventDefault();
      redo();
    }
  }
});

btnResetView.addEventListener('click', () => {
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  updateBackground();
  setStatus('Vista centrada', 'action');
});

btnNew.addEventListener('click', () => {
  if(confirm('¿Estás seguro que deseas limpiar el lienzo?')) {
    isHistoryProcessing = true;
    canvas.clear(); 
    canvas.backgroundColor = null; 
    canvas.renderAll();
    isHistoryProcessing = false;
    saveHistory(true); // reset history
    setStatus('Lienzo limpio');
  }
});

btnSaveProject.addEventListener('click', () => {
  const json = canvas.toJSON(['id', 'selectable', 'evented']);
  const blob = new Blob([JSON.stringify(json)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); 
  link.download = 'rosettadraw-proyecto.json'; 
  link.href = url;
  document.body.appendChild(link); 
  link.click(); 
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  setStatus('Proyecto guardado', 'action');
});

btnSave.addEventListener('click', () => {
  const dataURL = canvas.toDataURL({ format: 'png', quality: 1 });
  const link = document.createElement('a'); link.download = 'rosettadraw-imagen.png'; link.href = dataURL;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
});

btnImport.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  
  if (file.name.endsWith('.json')) {
    reader.onload = (f) => {
      try {
        const json = JSON.parse(f.target.result);
        isHistoryProcessing = true;
        canvas.loadFromJSON(json, () => {
          canvas.renderAll();
          isHistoryProcessing = false;
          saveHistory(true);
          setStatus('Proyecto cargado exitosamente', 'action');
          btnSelect.click();
        });
      } catch (err) {
        console.error('Error parsing JSON:', err);
        setStatus('Error al cargar el proyecto', 'action');
      }
    };
    reader.readAsText(file);
  } else {
    reader.onload = (f) => {
      const data = f.target.result;
      fabric.Image.fromURL(data, (img) => {
        // Scale down if image is too large
        if (img.width > canvas.width / 2 || img.height > canvas.height / 2) {
          img.scaleToWidth(canvas.width / 2);
        }
        img.set({
          left: canvas.width / 2,
          top: canvas.height / 2,
          originX: 'center',
          originY: 'center'
        });
        isHistoryProcessing = true;
        canvas.add(img);
        canvas.setActiveObject(img);
        isHistoryProcessing = false;
        saveHistory();
        btnSelect.click();
        setStatus('Imagen importada', 'action');
      });
    };
    reader.readAsDataURL(file);
  }
  
  // Reset input so the same file can be loaded again if needed
  fileInput.value = '';
});

// --- Properties Logic ---
function getFillColor() {
  return fillEnabledInput.checked ? fillColorInput.value : 'transparent';
}

function updateSelectedObjects() {
  const activeObjects = canvas.getActiveObjects();
  if (activeObjects.length === 0) return;
  
  const stroke = strokeColorInput.value;
  const fill = getFillColor();
  const strokeWidth = parseInt(strokeWidthInput.value, 10);

  activeObjects.forEach(obj => {
    if (obj.type === 'i-text') {
      obj.set({ fill: stroke }); // El texto usa 'fill' para el color de fuente
    } else if (obj.arrowStyle) {
      // Las flechas solo actualizan el trazo; el fill lo maneja su propio motor de dibujo
      const arrowFill = obj.arrowStyle.includes('filled') ? stroke : 'transparent';
      obj.set({ stroke: stroke, fill: arrowFill, strokeWidth: strokeWidth });
    } else {
      obj.set({ stroke: stroke, fill: fill, strokeWidth: strokeWidth });
    }
  });
  canvas.renderAll();
}

strokeColorInput.addEventListener('input', () => {
  if (currentTool === 'pencil') canvas.freeDrawingBrush.color = strokeColorInput.value;
  updateSelectedObjects();
});

fillColorInput.addEventListener('input', updateSelectedObjects);

fillEnabledInput.addEventListener('change', () => {
  fillColorInput.disabled = !fillEnabledInput.checked;
  updateSelectedObjects();
});

strokeWidthInput.addEventListener('input', () => {
  const val = strokeWidthInput.value;
  strokeWidthVal.textContent = val + 'px';
  if (currentTool === 'pencil') {
    canvas.freeDrawingBrush.width = parseInt(val, 10);
  }
  updateSelectedObjects();
});

eraserWidthInput.addEventListener('input', () => {
  const val = eraserWidthInput.value;
  eraserWidthVal.textContent = val + 'px';
  if (currentTool === 'eraser') {
    canvas.freeDrawingBrush.width = parseInt(val, 10);
    updateEraserCursor();
  }
});

textSizeInput.addEventListener('input', () => {
  const val = textSizeInput.value;
  textSizeVal.textContent = val + 'px';
  
  const activeObj = canvas.getActiveObject();
  if (activeObj && ['i-text', 'text'].includes(activeObj.type)) {
    activeObj.set({ 
      fontSize: parseInt(val, 10),
      scaleX: 1,
      scaleY: 1
    });
    canvas.renderAll();
    saveHistory();
  }
});

// Actualizar barra de herramientas cuando se selecciona un objeto
canvas.on('selection:created', handleSelection);
canvas.on('selection:updated', handleSelection);

function handleSelection(e) {
  const obj = e.selected[0];
  if (!obj) return;

  if (obj.type === 'i-text' || obj.type === 'text') {
    strokeColorInput.value = obj.fill || '#000000';
    const actualFontSize = Math.round(obj.fontSize * obj.scaleY);
    textSizeInput.value = actualFontSize;
    textSizeVal.textContent = actualFontSize + 'px';
  } else {
    if (obj.stroke) strokeColorInput.value = obj.stroke;
    if (obj.strokeWidth) {
      strokeWidthInput.value = obj.strokeWidth;
      strokeWidthVal.textContent = obj.strokeWidth + 'px';
    }
    if (obj.fill === 'transparent' || !obj.fill) {
      fillEnabledInput.checked = false;
      fillColorInput.disabled = true;
    } else {
      fillEnabledInput.checked = true;
      fillColorInput.disabled = false;
      fillColorInput.value = obj.fill;
    }
  }
}

// --- Magic Pen Logic ---
btnMagic.addEventListener('click', () => {
  setTool('magic', btnMagic, true);
  setStatus('Lápiz Mágico Activado', 'magic');
  // Lápiz mágico siempre usa su color morado distintivo temporalmente
  canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
  canvas.freeDrawingBrush.color = '#8b5cf6';
  canvas.freeDrawingBrush.width = parseInt(strokeWidthInput.value, 10) + 2; 
});

// Capturar puntos del trazo en tiempo real para Google Handwriting
let currentStrokeX = [];
let currentStrokeY = [];
let currentStrokeT = [];
let strokeStartTime = 0;

// Lógica de Mouse en el Canvas
canvas.on('mouse:down', (e) => {
  if (isPanning) return;
  const pointer = canvas.getPointer(e.e);
  
  if (isMagicMode) {
    if (magicDebounceTimer) clearTimeout(magicDebounceTimer);
    strokeStartTime = Date.now();
    currentStrokeX = [];
    currentStrokeY = [];
    currentStrokeT = [];
    currentStrokeX.push(Math.round(pointer.x));
    currentStrokeY.push(Math.round(pointer.y));
    currentStrokeT.push(0);
    return;
  }

  // --- Dibujo manual de formas ---
  if (['rect', 'circle', 'triangle', 'line', 'arrow', 'text'].includes(currentTool)) {
    isDrawingShape = true;
    origX = pointer.x;
    origY = pointer.y;

    if (currentTool === 'text') {
      const textObj = new fabric.IText('Texto...', {
        left: origX, top: origY, fontFamily: 'sans-serif', fill: strokeColorInput.value,
        fontSize: parseInt(textSizeInput.value, 10), originX: 'left', originY: 'top', lineHeight: 1
      });
      canvas.add(textObj);
      canvas.setActiveObject(textObj);
      textObj.enterEditing();
      textObj.selectAll();
      isDrawingShape = false;
      btnSelect.click(); // Cambiar a selección tras crear
      return;
    }

    const commonProps = {
      left: origX, top: origY, fill: getFillColor(),
      stroke: strokeColorInput.value, strokeWidth: parseInt(strokeWidthInput.value, 10), selectable: false, evented: false
    };

    if (currentTool === 'rect') {
      activeShape = new fabric.Rect({ ...commonProps, originX: 'left', originY: 'top', width: 0, height: 0 });
    } else if (currentTool === 'circle') {
      activeShape = new fabric.Circle({ ...commonProps, originX: 'center', originY: 'center', radius: 0 });
    } else if (currentTool === 'triangle') {
      activeShape = new fabric.Triangle({ ...commonProps, originX: 'left', originY: 'top', width: 0, height: 0 });
    } else if (currentTool === 'line') {
      activeShape = new fabric.Line([origX, origY, origX, origY], { ...commonProps, originX: 'center', originY: 'center' });
    } else if (currentTool === 'arrow') {
      // Usaremos un Path dinámico para la flecha
      activeShape = new fabric.Path(`M ${origX} ${origY} L ${origX} ${origY}`, { ...commonProps, originX: 'left', originY: 'top' });
    }

    if (activeShape) canvas.add(activeShape);
  }
});

canvas.on('mouse:move', (e) => {
  const pointer = canvas.getPointer(e.e);

  if (isMagicMode && currentStrokeX.length > 0 && e.e.buttons) {
    currentStrokeX.push(Math.round(pointer.x));
    currentStrokeY.push(Math.round(pointer.y));
    currentStrokeT.push(Date.now() - strokeStartTime);
    return;
  }

  // --- Actualizar tamaño de la forma en tiempo real ---
  if (!isDrawingShape || !activeShape) return;

  if (currentTool === 'rect' || currentTool === 'triangle') {
    activeShape.set({ width: Math.abs(origX - pointer.x), height: Math.abs(origY - pointer.y) });
    if (pointer.x < origX) activeShape.set({ left: pointer.x });
    if (pointer.y < origY) activeShape.set({ top: pointer.y });
  } else if (currentTool === 'circle') {
    const radius = Math.max(Math.abs(origX - pointer.x), Math.abs(origY - pointer.y)) / 2;
    activeShape.set({ radius: radius });
  } else if (currentTool === 'line') {
    activeShape.set({ x2: pointer.x, y2: pointer.y });
  } else if (currentTool === 'arrow') {
    const headlen = 20; 
    const angle = Math.atan2(pointer.y - origY, pointer.x - origX);
    let pathString = '';

    if (currentArrowStyle === 'double') {
      const angleFwd = angle;
      const angleBack = angle + Math.PI;
      const lineStartX = origX + headlen * 0.8 * Math.cos(angleFwd);
      const lineStartY = origY + headlen * 0.8 * Math.sin(angleFwd);
      const lineEndX2 = pointer.x - headlen * 0.8 * Math.cos(angleFwd);
      const lineEndY2 = pointer.y - headlen * 0.8 * Math.sin(angleFwd);
      const fwd1x = pointer.x - headlen * Math.cos(angleFwd - Math.PI / 6);
      const fwd1y = pointer.y - headlen * Math.sin(angleFwd - Math.PI / 6);
      const fwd2x = pointer.x - headlen * Math.cos(angleFwd + Math.PI / 6);
      const fwd2y = pointer.y - headlen * Math.sin(angleFwd + Math.PI / 6);
      const back1x = origX - headlen * Math.cos(angleBack - Math.PI / 6);
      const back1y = origY - headlen * Math.sin(angleBack - Math.PI / 6);
      const back2x = origX - headlen * Math.cos(angleBack + Math.PI / 6);
      const back2y = origY - headlen * Math.sin(angleBack + Math.PI / 6);
      pathString = `M ${lineStartX} ${lineStartY} L ${lineEndX2} ${lineEndY2} `;
      pathString += `M ${pointer.x} ${pointer.y} L ${fwd1x} ${fwd1y} M ${pointer.x} ${pointer.y} L ${fwd2x} ${fwd2y} `;
      pathString += `M ${origX} ${origY} L ${back1x} ${back1y} M ${origX} ${origY} L ${back2x} ${back2y}`;
    } else {
      let stopDist = 0;
      if (currentArrowStyle.includes('triangle')) stopDist = headlen * 0.866;
      else if (currentArrowStyle.includes('diamond')) stopDist = headlen;
      const lineEndX = pointer.x - stopDist * Math.cos(angle);
      const lineEndY = pointer.y - stopDist * Math.sin(angle);
      pathString += `M ${origX} ${origY} L ${lineEndX} ${lineEndY} `;

      if (currentArrowStyle === 'normal') {
        const pt1x = pointer.x - headlen * Math.cos(angle - Math.PI / 6);
        const pt1y = pointer.y - headlen * Math.sin(angle - Math.PI / 6);
        const pt2x = pointer.x - headlen * Math.cos(angle + Math.PI / 6);
        const pt2y = pointer.y - headlen * Math.sin(angle + Math.PI / 6);
        pathString += `M ${pointer.x} ${pointer.y} L ${pt1x} ${pt1y} M ${pointer.x} ${pointer.y} L ${pt2x} ${pt2y}`;
      } else if (currentArrowStyle.includes('triangle')) {
        const pt1x = pointer.x - headlen * Math.cos(angle - Math.PI / 6);
        const pt1y = pointer.y - headlen * Math.sin(angle - Math.PI / 6);
        const pt2x = pointer.x - headlen * Math.cos(angle + Math.PI / 6);
        const pt2y = pointer.y - headlen * Math.sin(angle + Math.PI / 6);
        pathString += `M ${pointer.x} ${pointer.y} L ${pt1x} ${pt1y} L ${pt2x} ${pt2y} Z`;
      } else if (currentArrowStyle.includes('diamond')) {
        const basex = pointer.x - headlen * Math.cos(angle);
        const basey = pointer.y - headlen * Math.sin(angle);
        const midX = pointer.x - (headlen / 2) * Math.cos(angle);
        const midY = pointer.y - (headlen / 2) * Math.sin(angle);
        const halfWidth = headlen * 0.35;
        const perpAngle = angle + Math.PI / 2;
        const mid1x = midX + halfWidth * Math.cos(perpAngle);
        const mid1y = midY + halfWidth * Math.sin(perpAngle);
        const mid2x = midX - halfWidth * Math.cos(perpAngle);
        const mid2y = midY - halfWidth * Math.sin(perpAngle);
        pathString += `M ${pointer.x} ${pointer.y} L ${mid1x} ${mid1y} L ${basex} ${basey} L ${mid2x} ${mid2y} Z`;
      }
    }

    const fillVal = currentArrowStyle.includes('filled') ? strokeColorInput.value : 'transparent';
    
    canvas.remove(activeShape);
    activeShape = new fabric.Path(pathString, {
      fill: fillVal, stroke: strokeColorInput.value, strokeWidth: parseInt(strokeWidthInput.value, 10),
      selectable: false, evented: false, originX: 'left', originY: 'top', strokeLineJoin: 'round',
      arrowStyle: currentArrowStyle // guardamos el estilo para no sobreescribir el fill luego
    });
    canvas.add(activeShape);
  }

  canvas.renderAll();
});

canvas.on('mouse:up', () => {
  if (isMagicMode && currentStrokeX.length > 0) {
    if (currentStrokeX.length > 1) {
      magicStrokeData.push([currentStrokeX, currentStrokeY, currentStrokeT]);
    }
    currentStrokeX = []; currentStrokeY = []; currentStrokeT = [];
    return;
  }

  // --- Finalizar la forma ---
  if (isDrawingShape && activeShape) {
    isDrawingShape = false;
    activeShape.set({ selectable: true, evented: true });
    activeShape.setCoords();
    saveHistory();
    activeShape = null;
  }
});

canvas.on('erasing:end', () => {
  saveHistory();
});

canvas.on('path:created', (e) => {
  if (isMagicMode) {
    magicPaths.push(e.path);
    if (magicDebounceTimer) clearTimeout(magicDebounceTimer);
    magicDebounceTimer = setTimeout(processMagicPaths, MAGIC_TIMEOUT);
  }
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
    isHistoryProcessing = true;
    canvas.remove(magicPaths[0]);
    canvas.add(newShape);
    isHistoryProcessing = false;
    saveHistory();
    setStatus(`Forma detectada: ${newShape.type}`, 'magic');
    resetMagicMode();
    btnSelect.click(); // Cambiar a modo selección automáticamente
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
    if (candidates.length > 0) {
      const bestText = candidates[0].trim();
      if (bestText.length > 0) {
        let finalFontSize = Math.max(24, bBox.height);
        if (fixedTextSizeInput.checked) {
          finalFontSize = parseInt(textSizeInput.value, 10);
        }

        const textObj = new fabric.IText(bestText, {
          left: bBox.left, top: bBox.top, fontFamily: 'sans-serif',
          fill: strokeColorInput.value, 
          fontSize: finalFontSize,
          lineHeight: 1 // Reduce el espaciado interno (arriba/abajo) del cuadro de texto
        });
        
        isHistoryProcessing = true;
        magicPaths.forEach(p => canvas.remove(p));
        canvas.add(textObj);
        isHistoryProcessing = false;
        saveHistory();
        
        canvas.setActiveObject(textObj);
        setStatus('Texto detectado: ' + bestText, 'magic');
        btnSelect.click(); // Cambiar a modo selección para permitir doble clic y edición
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

// --- Undo / Redo History ---
function updateHistoryButtons() {
  btnUndo.disabled = undoStack.length <= 1;
  btnRedo.disabled = redoStack.length === 0;
  
  btnUndo.classList.toggle('opacity-50', btnUndo.disabled);
  btnRedo.classList.toggle('opacity-50', btnRedo.disabled);
}

function saveHistory(isReset = false) {
  if (isHistoryProcessing) return;
  
  if (isReset) {
    undoStack = [];
    redoStack = [];
  }
  
  undoStack.push(JSON.stringify(canvas.toDatalessJSON()));
  redoStack = []; // Clear redo stack on new action
  updateHistoryButtons();
}

function undo() {
  if (undoStack.length > 1) {
    isHistoryProcessing = true;
    redoStack.push(undoStack.pop()); // Move current state to redo
    const previousState = undoStack[undoStack.length - 1]; // Get previous
    
    canvas.loadFromJSON(previousState, () => {
      canvas.renderAll();
      isHistoryProcessing = false;
      updateHistoryButtons();
    });
  }
}

function redo() {
  if (redoStack.length > 0) {
    isHistoryProcessing = true;
    const nextState = redoStack.pop();
    undoStack.push(nextState);
    
    canvas.loadFromJSON(nextState, () => {
      canvas.renderAll();
      isHistoryProcessing = false;
      updateHistoryButtons();
    });
  }
}

btnUndo.addEventListener('click', undo);
btnRedo.addEventListener('click', redo);

// Capture canvas events for history
canvas.on('object:added', () => saveHistory());
canvas.on('object:modified', () => saveHistory());
canvas.on('object:removed', () => saveHistory());

// Save initial blank state
saveHistory(true);
