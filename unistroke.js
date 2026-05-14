// $1 Unistroke Recognizer (Adapted for App Lápiz)
// Based on the algorithm by Wobbrock, Wilson, Li (2007)

const NumPoints = 64;
const SquareSize = 250.0;
const Origin = { x: 0, y: 0 };
const Diagonal = Math.sqrt(SquareSize * SquareSize + SquareSize * SquareSize);
const HalfDiagonal = 0.5 * Diagonal;
const AngleRange = 45.0 * (Math.PI / 180.0);
const AnglePrecision = 2.0 * (Math.PI / 180.0);
const Phi = 0.5 * (-1.0 + Math.sqrt(5.0)); // Golden Ratio

function PathLength(points) {
  let d = 0.0;
  for (let i = 1; i < points.length; i++) {
    d += Distance(points[i - 1], points[i]);
  }
  return d;
}

function Distance(p1, p2) {
  let dx = p2.x - p1.x;
  let dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function Resample(points, n) {
  let I = PathLength(points) / (n - 1);
  let D = 0.0;
  let newpoints = [{ x: points[0].x, y: points[0].y }];
  for (let i = 1; i < points.length; i++) {
    let d = Distance(points[i - 1], points[i]);
    if (D + d >= I) {
      let qx = points[i - 1].x + ((I - D) / d) * (points[i].x - points[i - 1].x);
      let qy = points[i - 1].y + ((I - D) / d) * (points[i].y - points[i - 1].y);
      let q = { x: qx, y: qy };
      newpoints.push(q);
      points.splice(i, 0, q); // insert 'q' at position i
      D = 0.0;
    } else {
      D += d;
    }
  }
  if (newpoints.length == n - 1) {
    newpoints.push({ x: points[points.length - 1].x, y: points[points.length - 1].y });
  }
  return newpoints;
}

function Centroid(points) {
  let x = 0.0, y = 0.0;
  for (let i = 0; i < points.length; i++) {
    x += points[i].x;
    y += points[i].y;
  }
  x /= points.length;
  y /= points.length;
  return { x: x, y: y };
}

function IndicativeAngle(points) {
  let c = Centroid(points);
  return Math.atan2(c.y - points[0].y, c.x - points[0].x);
}

function RotateBy(points, angle) {
  let c = Centroid(points);
  let cos = Math.cos(angle);
  let sin = Math.sin(angle);
  let newpoints = [];
  for (let i = 0; i < points.length; i++) {
    let qx = (points[i].x - c.x) * cos - (points[i].y - c.y) * sin + c.x;
    let qy = (points[i].x - c.x) * sin + (points[i].y - c.y) * cos + c.y;
    newpoints.push({ x: qx, y: qy });
  }
  return newpoints;
}

function BoundingBox(points) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    if (points[i].x < minX) minX = points[i].x;
    if (points[i].x > maxX) maxX = points[i].x;
    if (points[i].y < minY) minY = points[i].y;
    if (points[i].y > maxY) maxY = points[i].y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function ScaleTo(points, size) {
  let B = BoundingBox(points);
  let newpoints = [];
  for (let i = 0; i < points.length; i++) {
    let qx = points[i].x * (size / B.width);
    let qy = points[i].y * (size / B.height);
    newpoints.push({ x: qx, y: qy });
  }
  return newpoints;
}

function TranslateTo(points, pt) {
  let c = Centroid(points);
  let newpoints = [];
  for (let i = 0; i < points.length; i++) {
    let qx = points[i].x + pt.x - c.x;
    let qy = points[i].y + pt.y - c.y;
    newpoints.push({ x: qx, y: qy });
  }
  return newpoints;
}

function PathDistance(pts1, pts2) {
  let d = 0.0;
  for (let i = 0; i < pts1.length; i++) { // assumes pts1.length == pts2.length
    d += Distance(pts1[i], pts2[i]);
  }
  return d / pts1.length;
}

function DistanceAtBestAngle(points, T, a, b, threshold) {
  let x1 = Phi * a + (1.0 - Phi) * b;
  let f1 = DistanceAtAngle(points, T, x1);
  let x2 = (1.0 - Phi) * a + Phi * b;
  let f2 = DistanceAtAngle(points, T, x2);
  while (Math.abs(b - a) > threshold) {
    if (f1 < f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = Phi * a + (1.0 - Phi) * b;
      f1 = DistanceAtAngle(points, T, x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = (1.0 - Phi) * a + Phi * b;
      f2 = DistanceAtAngle(points, T, x2);
    }
  }
  return Math.min(f1, f2);
}

function DistanceAtAngle(points, T, angle) {
  let newpoints = RotateBy(points, angle);
  return PathDistance(newpoints, T.points);
}

class Template {
  constructor(name, points) {
    this.name = name;
    this.points = Resample(points, NumPoints);
    let radians = IndicativeAngle(this.points);
    this.points = RotateBy(this.points, -radians);
    this.points = ScaleTo(this.points, SquareSize);
    this.points = TranslateTo(this.points, Origin);
  }
}

export class DollarRecognizer {
  constructor() {
    this.templates = [];
    
    // Generate templates programmatically
    const circlePts = [];
    for (let i = 0; i < 64; i++) {
      circlePts.push({ x: 100 + 100 * Math.cos(i * Math.PI / 32), y: 100 + 100 * Math.sin(i * Math.PI / 32) });
    }
    this.addTemplate("circle", circlePts);
    
    const rectPts = [
      {x: 10, y: 10}, {x: 200, y: 10}, {x: 200, y: 200}, {x: 10, y: 200}, {x: 10, y: 10}
    ];
    this.addTemplate("rectangle", rectPts);
    
    const triPts = [
      {x: 100, y: 10}, {x: 200, y: 190}, {x: 10, y: 190}, {x: 100, y: 10}
    ];
    this.addTemplate("triangle", triPts);
  }

  addTemplate(name, points) {
    this.templates.push(new Template(name, points));
  }

  recognize(points) {
    if (points.length < 10) return { name: "unknown", score: 0.0 };
    
    let pts = Resample(points, NumPoints);
    let radians = IndicativeAngle(pts);
    pts = RotateBy(pts, -radians);
    pts = ScaleTo(pts, SquareSize);
    pts = TranslateTo(pts, Origin);

    let b = +Infinity;
    let u = -1;
    for (let i = 0; i < this.templates.length; i++) {
      let d = DistanceAtBestAngle(pts, this.templates[i], -AngleRange, +AngleRange, AnglePrecision);
      if (d < b) {
        b = d;
        u = i;
      }
    }
    let score = 1.0 - (b / HalfDiagonal);
    return { name: (u === -1) ? "unknown" : this.templates[u].name, score: score };
  }
}
