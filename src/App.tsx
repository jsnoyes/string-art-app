import { useState, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import SliderComponent from './components/SliderComponent';

function App() {
  const END_ERROR_THRESHOLD = 20;
  const N_PINS = 360;
  const MIN_LOOP = 20;
  const MIN_DISTANCE = 20;
  const LINE_WEIGHT = 50;
  const INIT_RESULT_DIAMETER = 650;
  
  const [image, setImage] = useState<HTMLImageElement>();
  const [resultImage, setResultImage] = useState<any>(null);
  const [pinSequence, setPinSequence] = useState<number[]>([]);
  const [lineWidth, setLineWidth] = useState<number>(1);
  const scale = useRef<number>(1);

  const { getRootProps, getInputProps } = useDropzone({
    accept: {'image/jpeg': ['.jpg'], 'image/png': ['.png']},
    onDrop: acceptedFiles => {
      const file = acceptedFiles[0];
      if (file) {
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

    processData(image!).catch((e) => console.log(e));
  }, [image])

  useEffect(() => {
    if (image) {
    }
  }, [image]);

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

    let { lineCache, lineCacheLength } = createBuffers(pinCoords);

    // start line sequence calculations
    await lineSequenceCalculation(grayImg, pinCoords, lineCache, lineCacheLength, img.width);

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
    // let lineCacheY = new Map<string, number[]>();
    let lineCacheLength = new Map<string, number>();
  
    for(let a=0; a<N_PINS; a++){
      for(let b=a+MIN_DISTANCE; b<N_PINS; b++){
        let { x: x0, y: y0 } = pinCoords[a];
        let { x: x1, y: y1 } = pinCoords[b];
  
        let points = bresenhamLine(x0, y0, x1, y1);
        let d = points.length;
  
        lineCache.set(`${a},${b}`, points);
        lineCache.set(`${b},${a}`, points);
        // lineCacheY.set(`${a},${b}`, points.map(p => p.y));
        // lineCacheY.set(`${b},${a}`, points.map(p => p.y));
        lineCacheLength.set(`${a},${b}`, d);
        lineCacheLength.set(`${b},${a}`, d);
      }
    }
  
    return { lineCache, lineCacheLength };
  };

  async function lineSequenceCalculation(grayImg: Uint8ClampedArray, pinCoords: Point[],
    lineCache: Map<string, Point[]>, lineCacheLength: Map<string, number>, dimension: number) : Promise<void> {
      
    let lastPinsArrInx: number = 0;
    let lastPinsArr: number[] = [];
    let lastPinsSet: Set<number> = new Set();
     
    let pin = 0;
    let lineSequence: number[] = [pin];

    const weight = LINE_WEIGHT;
     
    var error: Uint8ClampedArray = new Uint8ClampedArray(grayImg.length);
    for(let i = 0; i < grayImg.length; i++){
      error[i] = 0xFF - grayImg[i]; // Using the red channel
    }
     

    let result = document.createElement('canvas');
    result.width = dimension * scale.current;
    result.height = result.width;

    let resCtx = result.getContext('2d')!;    
    resCtx.fillStyle = '#FFFFFF';
    resCtx.fillRect(0, 0, result.width, result.height);
    resCtx.lineWidth = lineWidth;
    resCtx.globalAlpha = LINE_WEIGHT / 255;    
    resCtx.beginPath();

    let withinErrorThreshold = true;
    while(withinErrorThreshold){     
      let maxErr = -Infinity;
      let bestPin = -1;
        
      for(let offset=MIN_DISTANCE; offset < N_PINS - MIN_DISTANCE; offset++){
        let testPin = (pin + offset) % N_PINS;
        if(lastPinsSet.has(testPin)) continue;
           
        let points = lineCache.get(`${testPin},${pin}`)!;
           
        let lineErr = calculateLineError(points, dimension, grayImg, error);
     
        lineErr = lineErr / points.length;
        if(lineErr > maxErr){
          maxErr = lineErr;
          bestPin = testPin;
        }
      }
      if(maxErr < END_ERROR_THRESHOLD){
        withinErrorThreshold = false;
        continue;
      }
     
      lineSequence.push(bestPin);
     
      let points = lineCache.get(`${bestPin},${pin}`)!;
      
      for(const point of points){
        let idx = (point.y * dimension + point.x);
        error[idx] -= weight;
      }

      const curIdx = lastPinsArrInx++ % MIN_LOOP;
      if(lastPinsArrInx >= MIN_LOOP){
        const pinToRemove = lastPinsArr[curIdx];
        lastPinsSet.delete(pinToRemove);
        lastPinsArr[curIdx] = bestPin;
      } else {
        lastPinsArr.push(bestPin);
      }
      lastPinsSet.add(bestPin);

        
      if(lineSequence.length % 100 === 0){
        resCtx.stroke();
        resCtx.beginPath();
        setResultImage(result.toDataURL());
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      paint(bestPin, pin, pinCoords, result!, resCtx!);

      pin = bestPin;       
      
      setPinSequence([...lineSequence]);
    };

    resCtx.stroke();
    setResultImage(result.toDataURL());
  };

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


