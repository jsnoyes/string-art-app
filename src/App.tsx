import { useState, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import SliderComponent from './components/SliderComponent';

function App() {
  const END_ERROR_THRESHOLD = 15;
  const N_PINS = 360;
  const MIN_LOOP = 20;
  const MIN_DISTANCE = 20;
  const LINE_WEIGHT = 15;
  const INIT_RESULT_DIAMETER = 650;
  
  const [image, setImage] = useState<HTMLImageElement | null>();
  const [resultImage, setResultImage] = useState<any>(null);
  const [pinSequence, setPinSequence] = useState<number[]>([]);
  const [lineWidth, setLineWidth] = useState<number>(1);
  const scale = useRef<number>(1);

  const { getRootProps, getInputProps } = useDropzone({
    accept: {'image/jpeg': ['.jpg'], 'image/png': ['.png']},
    onDrop: acceptedFiles => {
      const file = acceptedFiles[0];
      if (file) {
        setImage(null);
        setResultImage(null);
        
        const reader = new FileReader();
        reader.onload = async (e) => {
          let img = new Image();
          img.onload = () => {
            setImage(img);
          };
          img.src = URL.createObjectURL(file);
        };
      reader.readAsArrayBuffer(file);
    }
  }});

  useEffect(() => {
    if(!image)
      return;

    scale.current = INIT_RESULT_DIAMETER / image.width;

    processData(image).catch((e) => console.log(e));
  }, [image])

  const processData = async (img: HTMLImageElement) => {
    const timeStart = performance.now();

    // Create a canvas element to draw and process image
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    

    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    let imgData: ImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    let grayImg: Uint8ClampedArray  = createGrayScale(imgData);

    let pinCoords = getPinCoords(canvas.width);

    let lineCache = createBuffers(pinCoords);

    // start line sequence calculations
    await lineSequenceCalculation(grayImg, pinCoords, lineCache, img.width);

    const timeEnd = performance.now();

    console.log("Time taken: " + (timeEnd - timeStart));
  } 

  // convert image to grayscale
  const createGrayScale = (imgData: ImageData) => {
    const resultArr: Uint8ClampedArray = new Uint8ClampedArray(imgData.data.length / 4);
    for(let i=0, j=0; i< imgData.data.length; i+=4, j++) {
      const avg = (imgData.data[i] + imgData.data[i+1] + imgData.data[i+2]) / 3;
      resultArr[j] = avg;
    }
    adjustContrast(resultArr, 50);
    whiteMaskCircle(resultArr, imgData.width)
    return resultArr;
  };

  const whiteMaskCircle = (imgData: Uint8ClampedArray, dimension: number) => {
    const centerDim = dimension / 2;
    const radiusSquared = Math.pow(centerDim, 2);

    let x=0,y=0,i=0;
    while(i < imgData.length){
      const distSquared = Math.pow(x - centerDim, 2) + Math.pow(y - centerDim, 2);

      if (distSquared > radiusSquared) {
        imgData[i] = 255;
      }
      
      i++;
      x++;
      if(x === dimension){
        y++;
        x = 0;
      }
    }
  }

  // calculate pin coordinates
  const getPinCoords = (length: number) =>  {
    let pinCoords: Point[] = [];
    let center = length / 2;
    let radius = length / 2 - 0.5

    for(let i=0; i<N_PINS; i++){
      let angle = 2 * Math.PI * i / N_PINS;
      pinCoords.push({
        x: Math.floor(center + radius * Math.cos(angle)),
        y: Math.floor(center + radius * Math.sin(angle))
      });
    }

    return pinCoords;
  };

  const bresenhamLine = (x1: number, y1: number, x2: number, y2: number) => {
    const deltaX = Math.abs(x2 - x1);
    const deltaY = Math.abs(y2 - y1);
    const sx = (x1 < x2) ? 1 : -1;
    const sy = (y1 < y2) ? 1 : -1;
    let err = deltaX - deltaY;
  
    const points = [];
  
    while(true) {
      points.push({ x: x1, y: y1 });
  
      if ((x1 === x2) && (y1 === y2)) break;
      let e2 = 2 * err;
      if (e2 > -deltaY) { err -= deltaY; x1 += sx; }
      if (e2 < deltaX) { err += deltaX; y1 += sy; }
    }
  
    return points;
  }

  const createBuffers = (pinCoords: Point[]) => {
    let lineCache = new Map<string, Point[]>();
  
    for(let a=0; a<N_PINS; a++){
      for(let b=a+MIN_DISTANCE; b<N_PINS; b++){
        let { x: x0, y: y0 } = pinCoords[a];
        let { x: x1, y: y1 } = pinCoords[b];
  
        let points = bresenhamLine(x0, y0, x1, y1);
        let d = points.length;
  
        lineCache.set(`${a},${b}`, points);
        lineCache.set(`${b},${a}`, points);
      }
    }
  
    return lineCache;
  };

  async function lineSequenceCalculation(
    grayImg: Uint8ClampedArray,
    pinCoords: Point[],
    lineCache: Map<string, Point[]>,
    dimension: number
): Promise<void> {
    // Initialize variables for tracking used pins and the current pin
    let lastPinsArrInx = 0;
    let lastPinsArr: number[] = [];
    let lastPinsSet = new Set<number>();
    let pin = 0;
    let lineSequence: number[] = [pin];
    const weight = LINE_WEIGHT;

    // Initialize the error array from the grayscale image
    const error = initializeErrorArray(grayImg);

    // Create a canvas for drawing the result
    const { canvas: result, context: resCtx } = createResultCanvas(dimension);

    // Main loop: continue drawing lines until the error threshold is met
    let withinErrorThreshold = true;
    while (withinErrorThreshold) {
        // Find the best pin that maximizes the error reduction
        const { bestPin, maxError } = findBestPin(
            pin,
            lastPinsSet,
            lineCache,
            error,
            dimension,
            grayImg
        );

        // If the error is below the threshold, stop the loop
        if (maxError < END_ERROR_THRESHOLD) {
            withinErrorThreshold = false;
            continue;
        }

        // Add the best pin to the line sequence
        lineSequence.push(bestPin);

        // Update the error array by subtracting the line weight at each pixel along the line
        const points = lineCache.get(`${bestPin},${pin}`)!;
        updateErrorArray(points, error, weight, dimension);

        // Manage the circular buffer of recently used pins
        lastPinsArrInx = updateLastPins(bestPin, lastPinsArrInx, lastPinsArr, lastPinsSet);

        // Every 100 lines, update the canvas and pause briefly to prevent blocking the UI
        if (lineSequence.length % 100 === 0) {
            resCtx.stroke();
            resCtx.beginPath();
            setResultImage(result.toDataURL());
            await new Promise((resolve) => setTimeout(resolve, 1));
        }

        // Paint the line between the two pins
        paint(bestPin, pin, pinCoords, result, resCtx);

        // Move to the next pin
        pin = bestPin;

        // Update the line sequence state
        setPinSequence([...lineSequence]);
    }

    // Finalize drawing and set the result image
    resCtx.stroke();
    setResultImage(result.toDataURL());
}

/**
 * Initializes the error array by inverting the grayscale image.
 */
function initializeErrorArray(grayImg: Uint8ClampedArray): Uint8ClampedArray {
    const error = new Uint8ClampedArray(grayImg.length);
    for (let i = 0; i < grayImg.length; i++) {
        error[i] = 0xff - grayImg[i];
    }
    return error;
}

/**
 * Creates and initializes the result canvas.
 */
function createResultCanvas(dimension: number): {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
} {
    const result = document.createElement('canvas');
    result.width = dimension * scale.current;
    result.height = result.width;

    const resCtx = result.getContext('2d')!;
    resCtx.fillStyle = '#FFFFFF';
    resCtx.fillRect(0, 0, result.width, result.height);
    resCtx.lineWidth = lineWidth;
    resCtx.globalAlpha = LINE_WEIGHT / 255;
    resCtx.beginPath();

    return { canvas: result, context: resCtx };
}

/**
 * Finds the best pin that maximizes error reduction.
 */
function findBestPin(
    pin: number,
    lastPinsSet: Set<number>,
    lineCache: Map<string, Point[]>,
    error: Uint8ClampedArray,
    dimension: number,
    grayImg: Uint8ClampedArray
): { bestPin: number; maxError: number } {
    let maxErr = -Infinity;
    let bestPin = -1;

    for (let offset = MIN_DISTANCE; offset < N_PINS - MIN_DISTANCE; offset++) {
        const testPin = (pin + offset) % N_PINS;
        if (lastPinsSet.has(testPin)) continue;

        const points = lineCache.get(`${testPin},${pin}`)!;
        let lineErr = calculateLineError(points, dimension, grayImg, error);
        lineErr /= points.length;

        if (lineErr > maxErr) {
            maxErr = lineErr;
            bestPin = testPin;
        }
    }

    return { bestPin, maxError: maxErr };
}

/**
 * Updates the error array by subtracting the line weight at each pixel along the line.
 */
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

/**
 * Manages the circular buffer of recently used pins.
 */
function updateLastPins(
    bestPin: number,
    lastPinsArrInx: number,
    lastPinsArr: number[],
    lastPinsSet: Set<number>
): number {
    const curIdx = lastPinsArrInx % MIN_LOOP;
    lastPinsArrInx++;

    if (lastPinsArrInx > MIN_LOOP) {
        const pinToRemove = lastPinsArr[curIdx];
        lastPinsSet.delete(pinToRemove);
        lastPinsArr[curIdx] = bestPin;
    } else {
        lastPinsArr.push(bestPin);
    }

    lastPinsSet.add(bestPin);
    return lastPinsArrInx;
}



  function calculateLineError(points: Point[], dimension: number, grayImg: Uint8ClampedArray, error: Uint8ClampedArray) {
    let bonusCount = 0;
    let lineErr = 0;
    for (const point of points) {
      const idx = (point.y * dimension + point.x);
  
      if (grayImg[idx] < 50 && error[idx] > 50) {
        bonusCount++;
      }
      else {
        if (bonusCount > 1) {
          lineErr += bonusCount * bonusCount;
        }
        bonusCount = 0;
      }
  
      lineErr += error[idx] < 0 ? 0 : error[idx];
    }
    return lineErr;
  }

  const handleSliderChange = (value: number) => {
    setLineWidth(value);
  };
  
  function paint(pinFrom: number, pinTo: number, pinCoords: Point[], canv:  HTMLCanvasElement, ctx: CanvasRenderingContext2D  ){
    const from = pinCoords[pinFrom];
    const to = pinCoords[pinTo];

    const currentScale = scale.current;
    
    ctx.moveTo(from.x * currentScale, from.y * currentScale);
    ctx.lineTo(to.x * currentScale, to.y * currentScale);
  };

  function adjustContrast(imgData: Uint8ClampedArray, contrast: number) {
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

    for (let i = 0; i < imgData.length; i++) {
        imgData[i] = factor * (imgData[i] - 128) + 128;
    }
  }

  return (
    <div>
      <div {...getRootProps()}>
        <input {...getInputProps()} />
        <p>Drag & drop image here, or click to select one</p>
      </div>
      {image && <img src={image.src} alt="Uploaded preview" />}
      {resultImage && <img src={resultImage} alt="Processed preview" />}
      {pinSequence && <span>{pinSequence.length} - {pinSequence.join(', ')}</span>}
      <div>
        <h1>Slider Example</h1>
        <SliderComponent initialValue={4} onValueChange={handleSliderChange} />
      </div>
    </div>
  );
}

export default App;

type Point = {
  x: number,
  y: number
};


