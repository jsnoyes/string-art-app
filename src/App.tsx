import { useState, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import SliderComponent from './components/SliderComponent';

function App() {
  const MAX_LINES = 8000;
  const N_PINS = 36*8;
  const MIN_LOOP = 20;
  const MIN_DISTANCE = 20;      
  const LINE_WEIGHT = 15;
  const SCALE = 1;
  const HOOP_DIAMETER = 0.625;
  const ERROR_BONUS_THRESHOLD = 5;
  const ERROR_BONUS = 5;
  
  const [image, setImage] = useState<any>(null);
  const [grayscaleImage, setGrayscalImage] = useState<any>(null);
  const [resultImage, setResultImage] = useState<any>(null);
  const [pinSequence, setPinSequence] = useState<number[]>([]);
  const [lineWidth, setLineWidth] = useState<number>(1);
  const [resultCanvas, setResultCanvas] = useState<HTMLCanvasElement>();
  const [pinCoordinates, setPinCoordinates] = useState<Point[]>();
  const [resultContext, setResultContext] = useState<CanvasRenderingContext2D>();

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
    if (image) {
      processData().catch((e) => console.log(e));
    }
  }, [image]);

  const processData = async () => {
    const timeStart = performance.now();

    // Create a canvas element to draw and process image
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    

    canvas.width = image.width;
    canvas.height = image.height;
    ctx.drawImage(image, 0, 0);
    let imgData: ImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    let grayImg: ImageData  = createGrayScale(imgData);

    let pinCoords = getPinCoords(canvas.width);

    let { lineCacheX, lineCacheY, lineCacheLength } = createBuffers(pinCoords);

    // start line sequence calculations
    await lineSequenceCalculation(grayImg, pinCoords, lineCacheX, lineCacheY, lineCacheLength);

    const timeEnd = performance.now();

    console.log("Time taken: " + (timeEnd - timeStart));
  }

  // convert image to grayscale
  const createGrayScale = (imgData: ImageData) => {
    for(let i=0; i<imgData.data.length; i+=4) {
      const avg = (imgData.data[i] + imgData.data[i+1] + imgData.data[i+2]) / 3;
      imgData.data[i] = avg;
      imgData.data[i+1] = avg;
      imgData.data[i+2] = avg;
    }
    adjustContrast(imgData.data, 50);
    whiteMaskCircle(imgData)
    setGrayscalImage(imageDataToDataURL(imgData));
    return imgData;
  };

  const whiteMaskCircle = (imgData: ImageData) => {
    const centerX = imgData.width / 2;
    const centerY = imgData.height / 2;
    const radiusSquared = Math.pow(imgData.width / 2, 2);

    for (let y = 0; y < imgData.height; y++) {
      for (let x = 0; x < imgData.width; x++) {
        const index = (y * imgData.width + x) * 4;
        const distSquared = Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2);
        if (distSquared > radiusSquared) {
          imgData.data[index] = 255;     // Make R value white
          imgData.data[index + 1] = 255; // Make G value white
          imgData.data[index + 2] = 255; // Make B value white
          imgData.data[index + 3] = 255; // Alpha value
        }
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

    setPinCoordinates(pinCoords);
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
    let lineCacheX = new Map<string, number[]>();
    let lineCacheY = new Map<string, number[]>();
    let lineCacheLength = new Map<string, number>();
  
    for(let a=0; a<N_PINS; a++){
      for(let b=a+MIN_DISTANCE; b<N_PINS; b++){
        let { x: x0, y: y0 } = pinCoords[a];
        let { x: x1, y: y1 } = pinCoords[b];
  
        let points = bresenhamLine(x0, y0, x1, y1);
        let d = points.length;
  
        lineCacheX.set(`${a},${b}`, points.map(p => p.x));
        lineCacheX.set(`${b},${a}`, points.map(p => p.x));
        lineCacheY.set(`${a},${b}`, points.map(p => p.y));
        lineCacheY.set(`${b},${a}`, points.map(p => p.y));
        lineCacheLength.set(`${a},${b}`, d);
        lineCacheLength.set(`${b},${a}`, d);
      }
    }
  
    return { lineCacheX, lineCacheY, lineCacheLength };
  };

  const clip = (val: number, min: number, max: number) => {
    return Math.max(min, Math.min(max, val));
  }

  async function lineSequenceCalculation(grayImg: ImageData, pinCoords: Point[],
    lineCacheX: Map<string, number[]>, lineCacheY: Map<string, number[]>, lineCacheLength: Map<string, number>) : Promise<void> {
      
    let lastPins: number[] = [];
      
    let threadLength = 0;
     
    let pin = 0;
    let lineSequence: number[] = [pin];
     
    const errorCanvas = document.createElement('canvas');
    errorCanvas.width = grayImg.width;
    errorCanvas.height = grayImg.height;
    const errorCanvasCtx = errorCanvas.getContext('2d')!;
    var error = errorCanvasCtx.createImageData(errorCanvas.width, errorCanvas.height);
    for(let i = 0; i < grayImg.data.length; i += 4){
      error.data[i] = 0xFF - grayImg.data[i]; // Using the red channel
    }
    
    const lineMaskCanvas = document.createElement('canvas');
    lineMaskCanvas.width = grayImg.width;
    lineMaskCanvas.height = grayImg.height;
    const lineMaskCanvasCtx = lineMaskCanvas.getContext('2d')!;
    let line_mask = lineMaskCanvasCtx.createImageData(grayImg.width, grayImg.height);
     

    let result = document.createElement('canvas');
    result.width = grayImg.width * SCALE;
    result.height = grayImg.height * SCALE;
    setResultCanvas(result);

    let resCtx = result.getContext('2d')!;    
    resCtx.fillStyle = '#FFFFFF';
    resCtx.fillRect(0, 0, result.width, result.height);
    setResultContext(resCtx);

    let weight = LINE_WEIGHT;
  
    for(let l=0; l<MAX_LINES; l++){
      if (l % 100 === 0) {
        console.log(l);
        // calculate the error and log it please
      }
     
      let maxErr = -Infinity;
      let bestPin = -1;
        
      for(let offset=MIN_DISTANCE; offset < N_PINS - MIN_DISTANCE; offset++){
        let testPin = (pin + offset) % N_PINS;
        if(/*lineCache.has(pin + '-' + testPin) ||*/ lastPins.includes(testPin)) continue;
           
        let xs = lineCacheX.get(`${testPin},${pin}`)!;
        let ys = lineCacheY.get(`${testPin},${pin}`)!;
           
        let bonusCount = 0;
        let lineErr = 0;
        for(let i=0; i<xs.length; i++){
          const x = xs[i];
          const y = ys[i];
          
          // const neighbors = getNeighborPoints(x, y, error.width, error.height);
          // for(const neighbor of neighbors){
          //   const idx = (neighbor.y * error.width + neighbor.x)*4;
          //   if(grayImg.data[idx] > 200 && error.data[idx] < 56){
          //     lineErr += ERROR_BONUS;
          //   }
          // }


          const idx = (y * error.width + x)*4;

          if(grayImg.data[idx] < 50 && error.data[idx] > 50){
            bonusCount++
          }
          else{
            if(bonusCount > 1){
              lineErr += bonusCount * bonusCount;
            }
            bonusCount = 0;
          }

          // if(grayImg.data[idx] < 200)
            lineErr += error.data[idx];
            // if(error.data[idx] < 0)
            //   lineErr -= (error.data[idx] ^ 2);
          // else 
          //   lineErr -= error.data[idx];
        }
     
        lineErr = lineErr / xs.length;
        if(lineErr > maxErr){
          maxErr = lineErr;
          bestPin = testPin;
        }
      }
     
      lineSequence.push(bestPin);
      // lineCache.add(pin + "-" + bestPin);
     
      let xs = lineCacheX.get(`${bestPin},${pin}`)!;
      let ys = lineCacheY.get(`${bestPin},${pin}`)!;
     
    
      for(let i=0; i<line_mask.data.length; i++){
        line_mask.data[i] = 0;
      }
      
     
      for(let i=0; i<xs.length; i++){
        let idx = (ys[i] * line_mask.width + xs[i]) * 4;
        line_mask.data[idx] = weight; // Assuming the line_mask is only interested in the red channel
      }
      
      for(let i=0; i<xs.length; i++){
        let idx = (ys[i] * line_mask.width + xs[i]) * 4;
        error.data[idx] = clip(error.data[idx] - line_mask.data[idx], 0, 255);
      }
      
      
     
      // let threadPieceLength = Math.sqrt(Math.pow(pinCoords[bestPin].x - pinCoords[pin].x, 2)
      //                      + Math.pow(pinCoords[bestPin].y - pinCoords[pin].y, 2));
     
      // threadLength += HOOP_DIAMETER / length * threadPieceLength;
        
      lastPins.push(bestPin);
      if(lastPins.length > MIN_LOOP) lastPins.shift();
        
      if(lineSequence.length % 100 === 0){
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      paint(bestPin, pin, pinCoords, result!, resCtx!);

      pin = bestPin;       
      
      setPinSequence([...lineSequence]);
  };
  };

  function getNeighborPoints(row: number, col: number, totalRows: number, totalCols: number): Point[] {
    const neighbors: Point[] = [];
    const potentialNeighbors = [
        { row: row - 1, col: col },     // top
        { row: row + 1, col: col },     // bottom
        { row: row, col: col - 1 },     // left
        { row: row, col: col + 1 }      // right
    ];

    for (const { row: r, col: c } of potentialNeighbors) {
        if (r >= 0 && r < totalRows && c >= 0 && c < totalCols) {
            neighbors.push({ x: r, y: c });
        }
    }

    return neighbors;
}
  // function to wait for N ms


  const handleSliderChange = (value: number) => {
    setLineWidth(value);
  };
  
  function paint(pinFrom: number, pinTo: number, pinCoords: Point[], canv:  HTMLCanvasElement, ctx: CanvasRenderingContext2D  ){
    const {x: xFrom, y: yFrom} = pinCoords[pinFrom];
    const {x: xTo, y: yTo} = pinCoords[pinTo];
    
    ctx.beginPath();
    ctx.moveTo(xFrom * SCALE, yFrom * SCALE);
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = LINE_WEIGHT / 255;
    ctx.lineTo(xTo * SCALE, yTo * SCALE);
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    setResultImage(canv.toDataURL())
  };

  function imageDataToDataURL(imageData: ImageData): string {
      // Create a temporary canvas to draw the ImageData
      const canvas = document.createElement('canvas');
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
          throw new Error('Failed to get canvas 2D context.');
      }

      ctx.putImageData(imageData, 0, 0);
      return canvas.toDataURL();
  }

  function adjustContrast(imgData: Uint8ClampedArray, contrast: number) {
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

    for (let i = 0; i < imgData.length; i += 4) {
        // R, G, and B are the same for grayscale image
        imgData[i] = factor * (imgData[i] - 128) + 128;
        imgData[i + 1] = factor * (imgData[i + 1] - 128) + 128;
        imgData[i + 2] = factor * (imgData[i + 2] - 128) + 128;
    }
}

  return (
    <div>
      <div {...getRootProps()}>
        <input {...getInputProps()} />
        <p>Drag & drop image here, or click to select one</p>
      </div>
      {image && <img src={image.src} alt="Uploaded preview" />}
      {grayscaleImage && <img src={grayscaleImage} alt="Grayscale"/>}
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