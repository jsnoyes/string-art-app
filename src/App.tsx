import React, { useState, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';

function App() {
  const MAX_LINES = 4000;
  const N_PINS = 36*8;
  const MIN_LOOP = 20;             
  const MIN_DISTANCE = 20;          
  const LINE_WEIGHT = 15;            
  const SCALE = 15;                  
  const HOOP_DIAMETER = 0.625;       
  
  const [image, setImage] = useState<any>(null);
  const [grayscaleImage, setGrayscalImage] = useState<any>(null);
  const [resultImage, setResultImage] = useState<any>(null);
  const [pinSequence, setPinSequence] = useState<number[]>([]);

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
      processData();
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
    lineSequenceCalculation(grayImg, pinCoords, lineCacheX, lineCacheY, lineCacheLength);

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
  const getPinCoords = (length: number) => {
    let pinCoords = [];
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

  const createBuffers = (pinCoords: {x: number, y: number}[]) => {
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

  const lineSequenceCalculation = (grayImg: ImageData, pinCoords: {x: number, y: number}[], 
    lineCacheX: Map<string, number[]>, lineCacheY: Map<string, number[]>, lineCacheLength: Map<string, number>) => {
      
    let lastPins: number[] = [];
      
    let lineSequence: number[] = [];
    let threadLength = 0;
     
    let pin = 0;
    lineSequence.push(pin);
     
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
    let resCtx = result.getContext('2d')!;
    resCtx.fillStyle = '#FFFFFF';
    resCtx.fillRect(0, 0, result.width, result.height);

    const lineCache = new Set<string>();
  
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
           
        let lineErr = 0;
        for(let i=0; i<xs.length; i++){
          lineErr += error.data[(ys[i]*error.width + xs[i])*4];
        }
     
        if(lineErr > maxErr){
          maxErr = lineErr;
          bestPin = testPin;
        }
      }
     
      lineSequence.push(bestPin);
      // lineCache.add(pin + "-" + bestPin);
     
      let xs = lineCacheX.get(`${bestPin},${pin}`)!;
      let ys = lineCacheY.get(`${bestPin},${pin}`)!;
      let weight = LINE_WEIGHT;
     
    
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
      
      

      resCtx.beginPath();
      resCtx.moveTo(pinCoords[pin].x * SCALE, pinCoords[pin].y * SCALE);
      resCtx.lineTo(pinCoords[bestPin].x * SCALE, pinCoords[bestPin].y * SCALE);
      resCtx.stroke();
     
      // let threadPieceLength = Math.sqrt(Math.pow(pinCoords[bestPin].x - pinCoords[pin].x, 2)
      //                      + Math.pow(pinCoords[bestPin].y - pinCoords[pin].y, 2));
     
      // threadLength += HOOP_DIAMETER / length * threadPieceLength;
        
      lastPins.push(bestPin);
      if(lastPins.length > MIN_LOOP) lastPins.shift();
        
      pin = bestPin;
        
      setPinSequence([...lineSequence]);
    }
    setResultImage(result.toDataURL());
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

  return (
    <div>
      <div {...getRootProps()}>
        <input {...getInputProps()} />
        <p>Drag & drop image here, or click to select one</p>
      </div>
      {image && <img src={image.src} alt="Uploaded preview" />}
      {grayscaleImage && <img src={grayscaleImage} alt="Grayscale"/>}
      {resultImage && <img src={resultImage} alt="Processed preview" />}
      {pinSequence && <span>{pinSequence.join(', ')}</span>}
    </div>
  );
}

export default App;