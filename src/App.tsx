import { useState, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import SliderComponent from './components/SliderComponent';

type Individual = {
  pinSequence: number[];
  data?: Uint8ClampedArray;
  fitness: number;
};

function App() {
  const MAX_LINES = 8000;
  const END_ERROR_THRESHOLD = 10;
  const N_PINS = 360;
  const MIN_LOOP = 20;
  const MIN_DISTANCE = 20;      
  const LINE_WEIGHT = 15;
  const INIT_RESULT_DIAMETER = 650;

  const POPULATION_SIZE = 100;
  const ELITISM_PERCENTAGE = .1;
  const ELITISM_COUNT = Math.floor(POPULATION_SIZE * ELITISM_PERCENTAGE);
  const MUTATION_RATE = .01;
  const NUM_CROSSOVER_POINTS = 10;
  
  const [image, setImage] = useState<HTMLImageElement>();
  const [resultImage, setResultImage] = useState<any>(null);
  const [pinSequence, setPinSequence] = useState<number[]>([]);
  const [lineWidth, setLineWidth] = useState<number>(1);
  const [resultCanvas, setResultCanvas] = useState<HTMLCanvasElement>();
  const [pinCoordinates, setPinCoordinates] = useState<Point[]>();
  const [resultContext, setResultContext] = useState<CanvasRenderingContext2D>();
  const [resultDiameterPx, setResultDiameterPix] = useState<number>(INIT_RESULT_DIAMETER);
  const [scale, setScale] = useState<number>(1);
  const [generationNumber, setGenerationNumber] = useState<number>(0);

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
    if(!resultDiameterPx || !image)
          return;

    setScale(resultDiameterPx / image.width);
  }, [resultDiameterPx, image])

  useEffect(() => {
    if (image) {
      processData(image!).catch((e) => console.log(e));
    }
  }, [image]);

  const generate = (numPins: number): Individual => {
    let lastPin = -Infinity;

    const pinSequence = Array.from({length: 4000}, () => {
      const pin = generatePin(numPins, lastPin);
      lastPin = pin;
      return pin;
    });
    return {
      pinSequence,
      fitness: 0
    }
  }

  const generatePin = (numPins: number, lastPin: number, nextPin: number = -Infinity): number => {
    const randomPin = () => {
      return Math.floor(Math.random() * numPins);
    }

    let pin = randomPin();
    while(pin === lastPin || pin === nextPin || Math.abs(pin - lastPin) < MIN_DISTANCE || Math.abs(pin - nextPin) < MIN_DISTANCE){
      pin = randomPin();
    }
    return pin;
  }

  const getFitness = (ind: Individual, img: Uint8ClampedArray, lineCache: Map<string, Point[]>, dimension: number): number => {    
    ind.data = new Uint8ClampedArray(img.length).fill(255);
    for(let i = 0; i < ind.pinSequence.length - 1; i++){
      const startPin = ind.pinSequence[i];
      const endPin = ind.pinSequence[i+1];

      const line = getLine(lineCache, startPin, endPin);
      if((line?.length ?? 0) === 0){
        console.log(' dfsa '+  startPin + ' ' + endPin);
      }

      addValueToPoints(line, dimension, ind.data, LINE_WEIGHT);
    }

    let totalError = 0;
    // Optimize to only calculate inside of the circle
    for(let i = 0; i < img.length; i++){
      totalError += Math.abs(img[i] - ind.data[i]);
    }

    return totalError;
  }

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

    let result = document.createElement('canvas');
    result.width = img.width * scale;
    result.height = result.width;
    setResultCanvas(result);

    let resCtx = result.getContext('2d')!;    
    resCtx.fillStyle = '#FFFFFF';
    resCtx.lineWidth = lineWidth;
    resCtx.globalAlpha = LINE_WEIGHT / 255;  


    let currentGeneration = [];
    for(let i = 0; i < POPULATION_SIZE; i++){
      const life = generate(N_PINS);
      life.fitness = getFitness(life, grayImg, lineCache, img.width);
      currentGeneration.push(life);
    }

    const MAX_GENS_WITHOUT_IMPROVEMENT = 3;
    const TOURNAMENT_SIZE = 4;
    let gensWithoutImprovement = 0;
    let bestFitness = -Infinity;
    while(gensWithoutImprovement < MAX_GENS_WITHOUT_IMPROVEMENT){      
      resCtx.fillRect(0, 0, result.width, result.height);
      resCtx.beginPath();

      const nextGeneration: Individual[] = [];

      // Elitism
      const sortedByFitness = [...currentGeneration].sort((a,b) => a.fitness - b.fitness);
      const elites = sortedByFitness.slice(0, ELITISM_COUNT);

      elites.forEach((ind) => nextGeneration.push(ind));

      // Breed
      for(let i = 0; i < POPULATION_SIZE - ELITISM_COUNT; i++){
        const parent1 = selection(currentGeneration, TOURNAMENT_SIZE);
        const parent2 = selection(currentGeneration, TOURNAMENT_SIZE);

        const child = crossover(parent1, parent2, N_PINS, NUM_CROSSOVER_POINTS);

        mutate(N_PINS, child, MUTATION_RATE);

        child.fitness = getFitness(child, grayImg, lineCache, img.width);
        nextGeneration.push(child);
      }


      const best = nextGeneration.reduce((cur, next) => cur.fitness! > next.fitness! ? cur : next, nextGeneration[0]);
      if(best.fitness > bestFitness){
        bestFitness = best.fitness!;
        gensWithoutImprovement = 0;
      } else {
        gensWithoutImprovement++;
      }
      currentGeneration = nextGeneration;

      for(let i = 1; i < best.pinSequence.length; i++){
        paint(best.pinSequence[i - 1], best.pinSequence[i], pinCoords, result, resCtx);
      }
  
      resCtx.stroke();
      setResultImage(result.toDataURL());
      resCtx.clearRect(0, 0, result.width, result.height);
      setGenerationNumber((num) => num + 1);
      
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    




//    setResultContext(resCtx);


    // start line sequence calculations
    // await lineSequenceCalculation(grayImg, pinCoords, lineCache, lineCacheLength, img.width);

    const timeEnd = performance.now();

    console.log("Time taken: " + (timeEnd - timeStart));
  } 

  const crossover = (parent1: Individual, parent2: Individual, numPins: number, numCrossoverPoints: number): Individual => {
    const length = parent1.pinSequence.length;
    const childDna: number[] = [];

    // Generate N unique crossover points
    const crossoverPoints = [];
    while (crossoverPoints.length < numCrossoverPoints) {
        const rnd = Math.floor(Math.random() * (length - 2)) + 1; // from 1 to N - 1
        if (crossoverPoints.indexOf(rnd) === -1) crossoverPoints.push(rnd);
    }
    crossoverPoints.sort((a, b) => a - b);
  
    let p1 = parent1;
    let p2 = parent2;
    // Generate child DNA with N crossover points
    for (let i = 0, j = 0; i < length; i++) {
        if (i === crossoverPoints[j]) {
            j++;
            if(Math.abs(childDna[i - 1] - p2.pinSequence[i]) < MIN_DISTANCE) {
                childDna.push(generatePin(numPins, childDna[i - 1], p2.pinSequence[i + 1]));
            } else {
                childDna.push(p2.pinSequence[i]);
            }
            const pt = p1;
            p1 = p2;
            p2 = pt;
        } else {
            childDna.push(p1.pinSequence[i]);
        }
    }

    const child: Individual = {
        pinSequence: childDna,
        fitness: 0      
    };
    return child;
}

  const mutate = (numPins: number, ind: Individual, mutationRate: number): void => {
    for(let i = 0; i < ind.pinSequence.length; i++){
      if(Math.random() < mutationRate){
        ind.pinSequence[i] = generatePin(numPins, i === 0 ? -Infinity : ind.pinSequence[i - 1], i === ind.pinSequence.length - 1 ? Infinity : ind.pinSequence[i + 1]);
      }
    }
  }

  const selection = (population: Individual[], tournamentSize: number): Individual => {
    let best: Individual | null = null;

    // Tournament selection
    for (let i = 0; i < tournamentSize; i++) {
      const candidate = population[Math.floor(Math.random() * population.length)];
      if (best === null || candidate.fitness > best.fitness) {
        best = candidate;
      }
    }

    return best!;
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

  const clip = (val: number, min: number, max: number) => {
    return Math.max(min, Math.min(max, val));
  }

  async function lineSequenceCalculation(grayImg: Uint8ClampedArray, pinCoords: Point[],
    lineCache: Map<string, Point[]>, lineCacheLength: Map<string, number>, dimension: number) : Promise<void> {
      
    let lastPinsArrInx: number = 0;
    let lastPinsArr: number[] = [];
    let lastPinsSet: Set<number> = new Set();
      
    let threadLength = 0;
     
    let pin = 0;
    let lineSequence: number[] = [pin];

    const weight = LINE_WEIGHT;
     
    var error: Uint8ClampedArray = new Uint8ClampedArray(grayImg.length);// =  errorCanvasCtx.createImageData(errorCanvas.width, errorCanvas.height);
    for(let i = 0; i < grayImg.length; i++){
      error[i] = 0xFF - grayImg[i]; // Using the red channel
    }
    
    // const lineMaskCanvas = document.createElement('canvas');
    // lineMaskCanvas.width = grayImg.width;
    // lineMaskCanvas.height = grayImg.height;
    // const lineMaskCanvasCtx = lineMaskCanvas.getContext('2d')!;
    // let line_mask = lineMaskCanvasCtx.createImageData(grayImg.width, grayImg.height);
     

    let result = document.createElement('canvas');
    result.width = dimension * scale;
    result.height = result.width;
    setResultCanvas(result);

    let resCtx = result.getContext('2d')!;    
    resCtx.fillStyle = '#FFFFFF';
    resCtx.fillRect(0, 0, result.width, result.height);
    resCtx.lineWidth = lineWidth;
    resCtx.globalAlpha = LINE_WEIGHT / 255;    
    resCtx.beginPath();

    setResultContext(resCtx);

    let withinErrorThreshold = true;
    while(withinErrorThreshold){     
      let maxErr = -Infinity;
      let bestPin = -1;
        
      for(let offset=MIN_DISTANCE; offset < N_PINS - MIN_DISTANCE; offset++){
        let testPin = (pin + offset) % N_PINS;
        if(lastPinsSet.has(testPin)) continue;
           
        let points = getLine(lineCache, testPin, pin);
           
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
     
      let points = getLine(lineCache, bestPin, pin);
      
      addValueToPoints(points, dimension, error, weight);
     
      // let threadPieceLength = Math.sqrt(Math.pow(pinCoords[bestPin].x - pinCoords[pin].x, 2)
      //                      + Math.pow(pinCoords[bestPin].y - pinCoords[pin].y, 2));
     
      // threadLength += HOOP_DIAMETER / length * threadPieceLength;
        
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

  function getLine(lineCache: Map<string, Point[]>, startPin: number, endPin: number): Point[] {
    return lineCache.get(`${startPin},${endPin}`)!;
  }

  function addValueToPoints(points: Point[], dimension: number, arr: Uint8ClampedArray, weight: number) {
    for (const point of points) {
      let idx = (point.y * dimension + point.x);
      arr[idx] -= weight;
    }
  }

  const handleSliderChange = (value: number) => {
    setLineWidth(value);
  };
  
  function paint(pinFrom: number, pinTo: number, pinCoords: Point[], canv:  HTMLCanvasElement, ctx: CanvasRenderingContext2D  ){
    const from = pinCoords[pinFrom];
    const to = pinCoords[pinTo];
    
    ctx.moveTo(from.x * scale, from.y * scale);
    ctx.lineTo(to.x * scale, to.y * scale);
  };

  // function imageDataToDataURL(imageData: ImageData): string {
  //     // Create a temporary canvas to draw the ImageData
  //     const canvasTemp = document.createElement('canvas');
  //     canvasTemp.width = imageData.width;
  //     canvasTemp.height = imageData.height;
  //     const ctxTemp = canvasTemp.getContext('2d')!;

  //     ctxTemp.putImageData(imageData, 0, 0);

  //     const destCanvas = document.createElement('canvas');
  //     destCanvas.width = imageData.width * scale;
  //     destCanvas.height = destCanvas.width;
  //     const destCtx = destCanvas.getContext('2d')!;
  //     destCtx.drawImage(canvasTemp, 0, 0, imageData.width, imageData.height, 0, 0, destCanvas.width, destCanvas.height);
    
  //     // ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height);
      
  //     return destCanvas.toDataURL();
  // }

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
      {generationNumber && <span>Generation Number: {generationNumber}<br /></span>}
      {pinSequence && <span>Pin Sequence: {pinSequence.length} - {pinSequence.join(', ')}<br /></span>}
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


