import React, { useState, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import SliderComponent from './components/SliderComponent';

// Type Definitions
type Point = { x: number; y: number };
type RGBColor = { r: number; g: number; b: number };
type Segment = { pinFrom: number; pinTo: number; colorIndex: number };

// Constants
const END_ERROR_THRESHOLD = 15;
const N_PINS = 180; // Adjusted for performance
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

// Function to Compute Color Differences for Multiple Colors
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
      const key = `${a},${b}`;
      const { x: x0, y: y0 } = pinCoords[a];
      const { x: x1, y: y1 } = pinCoords[b];
      const points = bresenhamLine(x0, y0, x1, y1);
      lineCache.set(key, points);
    }
  }
  return lineCache;
}

// Function to Calculate Line Error for a Specific Color
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

// Function to Find Best Line and Color
function findBestLineAndColor(
  lineCache: Map<string, Point[]>,
  errorArrays: Uint8ClampedArray[],
  diffImgs: Uint8ClampedArray[],
  dimension: number
): { bestPinFrom: number; bestPinTo: number; maxError: number; bestColorIndex: number } {
  let maxErr = -Infinity;
  let bestPinFrom = -1;
  let bestPinTo = -1;
  let bestColorIndex = -1;

  for (const [key, points] of lineCache) {
    const [pinFromStr, pinToStr] = key.split(',');
    const pinFrom = parseInt(pinFromStr, 10);
    const pinTo = parseInt(pinToStr, 10);

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
        bestPinFrom = pinFrom;
        bestPinTo = pinTo;
        bestColorIndex = colorIdx;
      }
    }
  }

  return { bestPinFrom, bestPinTo, maxError: maxErr, bestColorIndex };
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

// Function to Order Segments for Each Color
function orderSegmentsForColor(
  segments: Segment[],
  pinCoords: Point[]
): Segment[] {
  if (segments.length === 0) return [];

  // Map pins to segments that start or end at that pin
  const pinToSegments = new Map<number, { segment: Segment; isStart: boolean }[]>();
  for (const segment of segments) {
    if (!pinToSegments.has(segment.pinFrom))
      pinToSegments.set(segment.pinFrom, []);
    pinToSegments.get(segment.pinFrom)!.push({ segment, isStart: true });
    if (!pinToSegments.has(segment.pinTo))
      pinToSegments.set(segment.pinTo, []);
    pinToSegments.get(segment.pinTo)!.push({ segment, isStart: false });
  }

  const orderedSegments: Segment[] = [];
  const usedSegments = new Set<Segment>();

  // Start with any segment
  let currentSegment = segments[0];
  orderedSegments.push(currentSegment);
  usedSegments.add(currentSegment);

  let currentPin = currentSegment.pinTo; // Starting pin

  while (usedSegments.size < segments.length) {
    let nextSegmentInfo = null;

    // Find a segment that connects to currentPin
    const possibleSegments = pinToSegments.get(currentPin) || [];
    for (const { segment, isStart } of possibleSegments) {
      if (usedSegments.has(segment)) continue;
      nextSegmentInfo = { segment, isStart };
      break;
    }

    if (nextSegmentInfo) {
      const { segment, isStart } = nextSegmentInfo;
      let nextSegment = { ...segment };
      if (isStart) {
        // No need to reverse if the segment starts at currentPin
      } else {
        // Reverse the segment if it ends at currentPin
        [nextSegment.pinFrom, nextSegment.pinTo] = [nextSegment.pinTo, nextSegment.pinFrom];
      }
      orderedSegments.push(nextSegment);
      usedSegments.add(segment);
      currentPin = nextSegment.pinTo;
    } else {
      // Find the closest unused segment
      let minDistance = Infinity;
      let closestSegment = null;
      let closestIsStart = true;
      let closestPin = -1;

      for (const segment of segments) {
        if (usedSegments.has(segment)) continue;
        const pins = [
          { pin: segment.pinFrom, isStart: true },
          { pin: segment.pinTo, isStart: false },
        ];
        for (const { pin, isStart } of pins) {
          const distance = pinDistance(pinCoords[currentPin], pinCoords[pin]);
          if (distance < minDistance) {
            minDistance = distance;
            closestSegment = segment;
            closestIsStart = isStart;
            closestPin = pin;
          }
        }
      }

      if (closestSegment) {
        let nextSegment = { ...closestSegment };
        if (!closestIsStart) {
          // Reverse the segment if the closest pin is the end pin
          [nextSegment.pinFrom, nextSegment.pinTo] = [nextSegment.pinTo, nextSegment.pinFrom];
        }
        orderedSegments.push(nextSegment);
        usedSegments.add(closestSegment);
        currentPin = nextSegment.pinTo;
      } else {
        break; // No segments left
      }
    }
  }

  return orderedSegments;
}


function pinDistance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Main Component
function App() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [lineWidth, setLineWidth] = useState<number>(1);
  const scale = useRef<number>(1);

  // State for Multiple Input Colors
  const [inputColors, setInputColors] = useState<RGBColor[]>([
    { r: 255, g: 0, b: 0 },
  ]);

  // **New State Variables**
  const [showSegments, setShowSegments] = useState<boolean>(false);
  const [displayedColorIndex, setDisplayedColorIndex] = useState<number | null>(null);
  const [resultImagesByColor, setResultImagesByColor] = useState<{ [key: number]: string }>({});
  const [orderedSegmentsByColorState, setOrderedSegmentsByColorState] = useState<{ [key: number]: Segment[] }>({});

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
    // Use createColorDifferences to get an array of color difference arrays
    const diffImgs = createColorDifferences(imgData, inputColors);
    const pinCoords = getPinCoords(canvas.width, N_PINS);
    const lineCache = createBuffers(pinCoords, N_PINS, MIN_DISTANCE);
    await lineSequenceCalculation(
      diffImgs,
      pinCoords,
      lineCache,
      canvas.width,
      setResultImage,
      setSegments,
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
    setSegments: (segments: Segment[]) => void,
    lineWidth: number,
    scaleValue: number,
    lineWeight: number,
    inputColors: RGBColor[]
  ): Promise<void> {
    const errorArrays = initializeErrorArrays(diffImgs);
    const segments: Segment[] = [];

    let withinErrorThreshold = true;
    while (withinErrorThreshold) {
      const { bestPinFrom, bestPinTo, maxError, bestColorIndex } = findBestLineAndColor(
        lineCache,
        errorArrays,
        diffImgs,
        dimension
      );
      if (maxError < END_ERROR_THRESHOLD) {
        withinErrorThreshold = false;
        continue;
      }
      const points = lineCache.get(`${bestPinFrom},${bestPinTo}`)!;
      updateErrorArray(
        points,
        errorArrays[bestColorIndex],
        lineWeight,
        dimension
      );
      segments.push({ pinFrom: bestPinFrom, pinTo: bestPinTo, colorIndex: bestColorIndex });

      // Remove the line from lineCache to prevent reusing
      lineCache.delete(`${bestPinFrom},${bestPinTo}`);

      if (segments.length % 100 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    }
    setSegments(segments);

    // Order Segments for Each Color
    const segmentsByColor: { [key: number]: Segment[] } = {};

    for (const segment of segments) {
      if (!segmentsByColor[segment.colorIndex]) {
        segmentsByColor[segment.colorIndex] = [];
      }
      segmentsByColor[segment.colorIndex].push(segment);
    }

    // Order the segments
    const orderedSegmentsByColor: { [key: number]: Segment[] } = {};
    for (const colorIndex in segmentsByColor) {
      const orderedSegments = orderSegmentsForColor(segmentsByColor[colorIndex], pinCoords);
      orderedSegmentsByColor[colorIndex] = orderedSegments;
    }

    // **Update state with ordered segments**
    setOrderedSegmentsByColorState(orderedSegmentsByColor);

    // Draw the Ordered Segments
    const { canvas: resultOrdered, context: resCtxOrdered } = createResultCanvas(
      dimension,
      scaleValue,
      lineWidth,
      LINE_WEIGHT / 255
    );

    // **Create images for each color**
    const resultImagesByColorTemp: { [key: number]: string } = {};

    for (const colorIndex in orderedSegmentsByColor) {
      const orderedSegments = orderedSegmentsByColor[colorIndex];
      const colorIdx = parseInt(colorIndex, 10);

      // Draw on combined canvas
      resCtxOrdered.strokeStyle = `rgb(${inputColors[colorIdx].r},${inputColors[colorIdx].g},${inputColors[colorIdx].b})`;
      resCtxOrdered.beginPath();

      let isFirstSegment = true;
      let lastPoint = null;
      for (const segment of orderedSegments) {
        const from = pinCoords[segment.pinFrom];
        const to = pinCoords[segment.pinTo];

        if (isFirstSegment) {
          resCtxOrdered.moveTo(from.x * scaleValue, from.y * scaleValue);
          isFirstSegment = false;
        } else if (lastPoint && (from.x !== lastPoint.x || from.y !== lastPoint.y)) {
          // Move to the starting point if not connected
          resCtxOrdered.moveTo(from.x * scaleValue, from.y * scaleValue);
        }
        resCtxOrdered.lineTo(to.x * scaleValue, to.y * scaleValue);
        lastPoint = to;
      }
      resCtxOrdered.stroke();

      // Create individual canvas for each color
      const { canvas: colorCanvas, context: colorCtx } = createResultCanvas(
        dimension,
        scaleValue,
        lineWidth,
        LINE_WEIGHT / 255
      );

      colorCtx.strokeStyle = `rgb(${inputColors[colorIdx].r},${inputColors[colorIdx].g},${inputColors[colorIdx].b})`;
      colorCtx.beginPath();

      isFirstSegment = true;
      lastPoint = null;
      for (const segment of orderedSegments) {
        const from = pinCoords[segment.pinFrom];
        const to = pinCoords[segment.pinTo];

        if (isFirstSegment) {
          colorCtx.moveTo(from.x * scaleValue, from.y * scaleValue);
          isFirstSegment = false;
        } else if (lastPoint && (from.x !== lastPoint.x || from.y !== lastPoint.y)) {
          colorCtx.moveTo(from.x * scaleValue, from.y * scaleValue);
        }
        colorCtx.lineTo(to.x * scaleValue, to.y * scaleValue);
        lastPoint = to;
      }
      colorCtx.stroke();

      resultImagesByColorTemp[colorIdx] = colorCanvas.toDataURL();
    }

    // Update state with the result images by color
    setResultImagesByColor(resultImagesByColorTemp);

    setResultImage(resultOrdered.toDataURL());
  }

  // Slider Change Handler
  const handleSliderChange = (value: number) => {
    setLineWidth(value);
  };

  // Handle Input Color Changes
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

  // Add a New Color Picker
  const addColorPicker = () => {
    setInputColors([...inputColors, { r: 0, g: 0, b: 0 }]);
  };

  // Remove a Color Picker
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
          src={
            displayedColorIndex === null
              ? resultImage
              : resultImagesByColor[displayedColorIndex]
          }
          alt="Processed preview"
          style={{ maxWidth: '100%' }}
        />
      )}
      {segments.length > 0 && (
        <div>
          <p>Total Segments Used: {segments.length}</p>
        </div>
      )}
      <div>
        <h2>Line Width</h2>
        <SliderComponent initialValue={4} onValueChange={handleSliderChange} />
      </div>
      {/* Color Pickers for Input Colors */}
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
      {/* **New Buttons and Display for Segments Data and Individual Colors** */}
      <div>
        <button onClick={() => setShowSegments(!showSegments)}>
          {showSegments ? 'Hide Segments Data' : 'Show Segments Data'}
        </button>
      </div>
      {showSegments && (
        <div>
          <h2>Segments Data</h2>
          {Object.entries(orderedSegmentsByColorState).map(([colorIndexStr, segments]) => (
            <div key={colorIndexStr}>
              <h3>Color {parseInt(colorIndexStr) + 1}</h3>
              <ul>
                {segments.map((segment, idx) => (
                  <li key={idx}>
                    Start Pin: {segment.pinFrom}, End Pin: {segment.pinTo}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <div>
        <h2>Display Results for Individual Colors</h2>
        <button onClick={() => setDisplayedColorIndex(null)}>Show All Colors</button>
        {inputColors.map((color, index) => (
          <button key={index} onClick={() => setDisplayedColorIndex(index)}>
            Show Only Color {index + 1}
          </button>
        ))}
      </div>
    </div>
  );
}

export default App;
