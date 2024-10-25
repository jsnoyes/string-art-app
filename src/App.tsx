import React, { useState, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import SliderComponent from './components/SliderComponent';

// Type Definitions
type Point = { x: number; y: number };
type RGBColor = { r: number; g: number; b: number };

// Constants
const END_ERROR_THRESHOLD = 15;
const N_PINS = 360;
const MIN_LOOP = 20;
const MIN_DISTANCE = 20;
const LINE_WEIGHT = 15;
const INIT_RESULT_DIAMETER = 650;

// Helper Functions

function adjustContrast(imgData: Uint8ClampedArray, contrast: number): void {
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  for (let i = 0; i < imgData.length; i++) {
    let newValue = factor * (imgData[i] - 128) + 128;
    imgData[i] = Math.max(0, Math.min(255, newValue));
  }
}

function whiteMaskCircle(imgData: Uint8ClampedArray, dimension: number): void {
  const centerDim = dimension / 2;
  const radiusSquared = centerDim * centerDim;
  let x = 0,
    y = 0,
    i = 0;
  while (i < imgData.length) {
    const distSquared = (x - centerDim) ** 2 + (y - centerDim) ** 2;
    if (distSquared > radiusSquared) {
      imgData[i] = 255;
    }
    i++;
    x++;
    if (x === dimension) {
      y++;
      x = 0;
    }
  }
}

// **Modified Function to Compute Color Differences for Multiple Colors**
function createColorDifferences(
  imgData: ImageData,
  inputColors: RGBColor[]
): Uint8ClampedArray[] {
  const { data } = imgData;
  const diffArrays = inputColors.map(() => new Uint8ClampedArray(data.length / 4));

  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    inputColors.forEach((color, idx) => {
      const diff =
        Math.abs(r - color.r) +
        Math.abs(g - color.g) +
        Math.abs(b - color.b);
      // Normalize diff to range 0-255
      const normDiff = Math.min(Math.floor((diff / 765) * 255), 255);
      diffArrays[idx][j] = normDiff;
    });
  }

  diffArrays.forEach((diffArr) => {
    adjustContrast(diffArr, 50);
    whiteMaskCircle(diffArr, imgData.width);
  });

  return diffArrays;
}

function getPinCoords(length: number, nPins: number): Point[] {
  const pinCoords: Point[] = [];
  const center = length / 2;
  const radius = length / 2 - 0.5;
  for (let i = 0; i < nPins; i++) {
    const angle = (2 * Math.PI * i) / nPins;
    pinCoords.push({
      x: Math.floor(center + radius * Math.cos(angle)),
      y: Math.floor(center + radius * Math.sin(angle)),
    });
  }
  return pinCoords;
}

function bresenhamLine(x1: number, y1: number, x2: number, y2: number): Point[] {
  const deltaX = Math.abs(x2 - x1);
  const deltaY = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = deltaX - deltaY;
  const points: Point[] = [];
  while (true) {
    points.push({ x: x1, y: y1 });
    if (x1 === x2 && y1 === y2) break;
    const e2 = 2 * err;
    if (e2 > -deltaY) {
      err -= deltaY;
      x1 += sx;
    }
    if (e2 < deltaX) {
      err += deltaX;
      y1 += sy;
    }
  }
  return points;
}

function createBuffers(
  pinCoords: Point[],
  nPins: number,
  minDistance: number
): Map<string, Point[]> {
  const lineCache = new Map<string, Point[]>();
  for (let a = 0; a < nPins; a++) {
    for (let b = a + minDistance; b < nPins; b++) {
      const { x: x0, y: y0 } = pinCoords[a];
      const { x: x1, y: y1 } = pinCoords[b];
      const points = bresenhamLine(x0, y0, x1, y1);
      lineCache.set(`${a},${b}`, points);
      lineCache.set(`${b},${a}`, points);
    }
  }
  return lineCache;
}

// **Modified Function to Calculate Line Error for a Specific Color**
function calculateLineErrorForColor(
  points: Point[],
  dimension: number,
  diffImg: Uint8ClampedArray,
  error: Uint8ClampedArray
): number {
  let bonusCount = 0;
  let lineErr = 0;
  for (const point of points) {
    const idx = point.y * dimension + point.x;
    if (diffImg[idx] < 50 && error[idx] > 50) {
      bonusCount++;
    } else {
      if (bonusCount > 1) {
        lineErr += bonusCount * bonusCount;
      }
      bonusCount = 0;
    }
    lineErr += error[idx] < 0 ? 0 : error[idx];
  }
  return lineErr;
}

function paint(
  pinFrom: number,
  pinTo: number,
  pinCoords: Point[],
  ctx: CanvasRenderingContext2D,
  scale: number,
  color: RGBColor
): void {
  ctx.strokeStyle = `rgb(${color.r},${color.g},${color.b})`;
  ctx.beginPath();
  const from = pinCoords[pinFrom];
  const to = pinCoords[pinTo];
  ctx.moveTo(from.x * scale, from.y * scale);
  ctx.lineTo(to.x * scale, to.y * scale);
  ctx.stroke();
}

function initializeErrorArrays(
  diffImgs: Uint8ClampedArray[]
): Uint8ClampedArray[] {
  return diffImgs.map((diffImg) => {
    const error = new Uint8ClampedArray(diffImg.length);
    for (let i = 0; i < diffImg.length; i++) {
      error[i] = 0xff - diffImg[i];
    }
    return error;
  });
}

function createResultCanvas(
  dimension: number,
  scale: number,
  lineWidth: number,
  lineAlpha: number
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = dimension * scale;
  canvas.height = canvas.width;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = lineAlpha;
  return { canvas, context: ctx };
}

// **Modified Function to Find Best Pin and Color**
function findBestPinAndColor(
  pin: number,
  lastPinsSet: Set<number>,
  lineCache: Map<string, Point[]>,
  errorArrays: Uint8ClampedArray[],
  diffImgs: Uint8ClampedArray[],
  dimension: number,
  nPins: number,
  minDistance: number
): { bestPin: number; maxError: number; bestColorIndex: number } {
  let maxErr = -Infinity;
  let bestPin = -1;
  let bestColorIndex = -1;

  for (let offset = minDistance; offset < nPins - minDistance; offset++) {
    const testPin = (pin + offset) % nPins;
    if (lastPinsSet.has(testPin)) continue;
    const points = lineCache.get(`${testPin},${pin}`);
    if (!points) continue;

    // Evaluate each color
    for (let colorIdx = 0; colorIdx < diffImgs.length; colorIdx++) {
      let lineErr = calculateLineErrorForColor(
        points,
        dimension,
        diffImgs[colorIdx],
        errorArrays[colorIdx]
      );
      lineErr /= points.length;
      if (lineErr > maxErr) {
        maxErr = lineErr;
        bestPin = testPin;
        bestColorIndex = colorIdx;
      }
    }
  }

  return { bestPin, maxError: maxErr, bestColorIndex };
}

function updateErrorArray(
  points: Point[],
  error: Uint8ClampedArray,
  weight: number,
  dimension: number
): void {
  for (const point of points) {
    const idx = point.y * dimension + point.x;
    error[idx] -= weight;
  }
}

function updateLastPins(
  bestPin: number,
  lastPinsArrInx: number,
  lastPinsArr: number[],
  lastPinsSet: Set<number>,
  minLoop: number
): number {
  const curIdx = lastPinsArrInx % minLoop;
  lastPinsArrInx++;
  if (lastPinsArrInx > minLoop) {
    const pinToRemove = lastPinsArr[curIdx];
    lastPinsSet.delete(pinToRemove);
    lastPinsArr[curIdx] = bestPin;
  } else {
    lastPinsArr.push(bestPin);
  }
  lastPinsSet.add(bestPin);
  return lastPinsArrInx;
}

// Main Component
function App() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [pinSequence, setPinSequence] = useState<number[]>([]);
  const [lineWidth, setLineWidth] = useState<number>(1);
  const scale = useRef<number>(1);

  // **State for Multiple Input Colors**
  const [inputColors, setInputColors] = useState<RGBColor[]>([
    { r: 255, g: 0, b: 0 },
  ]);

  // Image Upload Handler
  const { getRootProps, getInputProps } = useDropzone({
    accept: { 'image/jpeg': ['.jpg'], 'image/png': ['.png'] },
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length === 0) return;
      const file = acceptedFiles[0];
      const img = new Image();
      img.onload = () => {
        setImage(img);
      };
      img.src = URL.createObjectURL(file);
    },
  });

  // Process Image when it's uploaded or when inputColors change
  useEffect(() => {
    if (!image) return;
    scale.current = INIT_RESULT_DIAMETER / image.width;
    processData(image);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, inputColors]);

  const processData = async (img: HTMLImageElement) => {
    const timeStart = performance.now();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // **Use createColorDifferences to get an array of color difference arrays**
    const diffImgs = createColorDifferences(imgData, inputColors);
    const pinCoords = getPinCoords(canvas.width, N_PINS);
    const lineCache = createBuffers(pinCoords, N_PINS, MIN_DISTANCE);
    await lineSequenceCalculation(
      diffImgs,
      pinCoords,
      lineCache,
      canvas.width,
      setResultImage,
      setPinSequence,
      lineWidth,
      scale.current,
      LINE_WEIGHT,
      inputColors
    );
    const timeEnd = performance.now();
    console.log('Time taken: ' + (timeEnd - timeStart));
  };

  async function lineSequenceCalculation(
    diffImgs: Uint8ClampedArray[],
    pinCoords: Point[],
    lineCache: Map<string, Point[]>,
    dimension: number,
    setResultImage: (dataUrl: string) => void,
    setPinSequence: (sequence: number[]) => void,
    lineWidth: number,
    scaleValue: number,
    lineWeight: number,
    inputColors: RGBColor[]
  ): Promise<void> {
    let lastPinsArrInx = 0;
    let lastPinsArr: number[] = [];
    let lastPinsSet = new Set<number>();
    let pin = 0;
    let lineSequence: number[] = [pin];
    // **Initialize error arrays for each color**
    const errorArrays = initializeErrorArrays(diffImgs);
    const { canvas: result, context: resCtx } = createResultCanvas(
      dimension,
      scaleValue,
      lineWidth,
      LINE_WEIGHT / 255
    );
    let withinErrorThreshold = true;
    while (withinErrorThreshold) {
      const { bestPin, maxError, bestColorIndex } = findBestPinAndColor(
        pin,
        lastPinsSet,
        lineCache,
        errorArrays,
        diffImgs,
        dimension,
        N_PINS,
        MIN_DISTANCE
      );
      if (maxError < END_ERROR_THRESHOLD) {
        withinErrorThreshold = false;
        continue;
      }
      lineSequence.push(bestPin);
      const points = lineCache.get(`${bestPin},${pin}`)!;
      // **Update the error array for the selected color**
      updateErrorArray(
        points,
        errorArrays[bestColorIndex],
        lineWeight,
        dimension
      );
      lastPinsArrInx = updateLastPins(
        bestPin,
        lastPinsArrInx,
        lastPinsArr,
        lastPinsSet,
        MIN_LOOP
      );
      if (lineSequence.length % 100 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        setResultImage(result.toDataURL());
      }
      // **Draw the line with the selected color**
      paint(
        bestPin,
        pin,
        pinCoords,
        resCtx,
        scaleValue,
        inputColors[bestColorIndex]
      );
      pin = bestPin;
      setPinSequence([...lineSequence]);
    }
    setResultImage(result.toDataURL());
  }

  // Slider Change Handler
  const handleSliderChange = (value: number) => {
    setLineWidth(value);
  };

  // **Handle Input Color Changes**
  const handleColorChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    index: number
  ) => {
    const hexColor = e.target.value;
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    const newInputColors = [...inputColors];
    newInputColors[index] = { r, g, b };
    setInputColors(newInputColors);
  };

  // **Add a New Color Picker**
  const addColorPicker = () => {
    setInputColors([...inputColors, { r: 0, g: 0, b: 0 }]);
  };

  // **Remove a Color Picker**
  const removeColorPicker = (index: number) => {
    const newInputColors = inputColors.filter((_, idx) => idx !== index);
    setInputColors(newInputColors);
  };

  return (
    <div>
      <div
        {...getRootProps()}
        style={{ border: '2px dashed #cccccc', padding: '20px' }}
      >
        <input {...getInputProps()} />
        <p>Drag &amp; drop an image here, or click to select one</p>
      </div>
      {image && (
        <img
          src={image.src}
          alt="Uploaded preview"
          style={{ maxWidth: '100%' }}
        />
      )}
      {resultImage && (
        <img
          src={resultImage}
          alt="Processed preview"
          style={{ maxWidth: '100%' }}
        />
      )}
      {pinSequence.length > 0 && (
        <div>
          <p>Total Pins Used: {pinSequence.length}</p>
          {/* Optionally display the pin sequence */}
          {/* <p>Pin Sequence: {pinSequence.join(', ')}</p> */}
        </div>
      )}
      <div>
        <h2>Line Width</h2>
        <SliderComponent initialValue={4} onValueChange={handleSliderChange} />
      </div>
      {/* **Color Pickers for Input Colors** */}
      <div>
        <h2>Select Input Colors</h2>
        {inputColors.map((color, index) => (
          <div key={index} style={{ marginBottom: '10px' }}>
            <input
              type="color"
              value={`#${(
                (1 << 24) +
                (color.r << 16) +
                (color.g << 8) +
                color.b
              )
                .toString(16)
                .slice(1)}`}
              onChange={(e) => handleColorChange(e, index)}
            />
            <button onClick={() => removeColorPicker(index)}>Remove</button>
          </div>
        ))}
        <button onClick={addColorPicker}>Add Color</button>
      </div>
    </div>
  );
}

export default App;
