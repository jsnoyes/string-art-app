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
  const MAX_GENS_WITHOUT_IMPROVEMENT = 250;

  const POPULATION_SIZE = 20;
  const ELITISM_PERCENTAGE = .1;
  const ELITISM_COUNT = Math.floor(POPULATION_SIZE * ELITISM_PERCENTAGE);
  const MUTATION_RATE = .01;
  const NUM_CROSSOVER_POINTS = 1;
  
  const [image, setImage] = useState<HTMLImageElement>();
  const [resultImage, setResultImage] = useState<any>(null);
  const [lineWidth, setLineWidth] = useState<number>(1);
  const [resultCanvas, setResultCanvas] = useState<HTMLCanvasElement>();
  const [pinCoordinates, setPinCoordinates] = useState<Point[]>();
  const [resultDiameterPx, setResultDiameterPix] = useState<number>(INIT_RESULT_DIAMETER);
  const [scale, setScale] = useState<number>(1);
  const [generationNumber, setGenerationNumber] = useState<number>(0);
  const [gensWithoutImprovement, setGensWithoutImprovement] = useState<number>(0);
  const [bestInd, setBestInd] = useState<Individual | undefined>(undefined);

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

  const getFitness = (ind: Individual, img: Uint8ClampedArray): number => {
    let totalError = 0;
    // Optimize to only calculate inside of the circle
    for(let i = 0; i < img.length; i++){
      totalError += Math.abs(img[i] - ind.data![i]);
    }

    return Number.MAX_SAFE_INTEGER - totalError;
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

    let { lineCache, lineCacheLength } = createBuffers(pinCoords, img.width);

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
      life.data = mapPinsToData(life.pinSequence, grayImg, lineCache);
      life.fitness = getFitness(life, grayImg);
      currentGeneration.push(life);
    }

    const TOURNAMENT_SIZE = 4;
    let bestFitness = -Infinity;
    let generationsWithoutImprovement = 0;
    while(generationsWithoutImprovement < MAX_GENS_WITHOUT_IMPROVEMENT){      
      resCtx.fillRect(0, 0, result.width, result.height);
      resCtx.beginPath();

      const nextGeneration: Individual[] = [];

      // Elitism
      const sortedByFitness = [...currentGeneration].sort((a,b) => b.fitness - a.fitness);
      const elites = sortedByFitness.slice(0, ELITISM_COUNT);

      elites.forEach((ind) => nextGeneration.push(ind));

      // Breed
      for(let i = 0; i < POPULATION_SIZE - ELITISM_COUNT; i++){
        const parent1 = selection(currentGeneration, TOURNAMENT_SIZE);
        const parent2 = selection(currentGeneration, TOURNAMENT_SIZE);

        const child = crossover(parent1, parent2, N_PINS, NUM_CROSSOVER_POINTS, grayImg, lineCache);

        mutate(N_PINS, child, MUTATION_RATE, lineCache, grayImg);

        child.fitness = getFitness(child, grayImg);
        nextGeneration.push(child);
      }


      const best = nextGeneration.reduce((cur, next) => cur.fitness! > next.fitness! ? cur : next, nextGeneration[0]);
      if(best.fitness > bestFitness){
        bestFitness = best.fitness;
        generationsWithoutImprovement = 0
        setGensWithoutImprovement(generationsWithoutImprovement);
        setBestInd(best);
        for(let i = 1; i < best.pinSequence.length; i++){
          paint(best.pinSequence[i - 1], best.pinSequence[i], pinCoords, result, resCtx);
        }
    
        resCtx.stroke();
        setResultImage(result.toDataURL());
        resCtx.clearRect(0, 0, result.width, result.height);
      } else {
        generationsWithoutImprovement++;
        setGensWithoutImprovement(generationsWithoutImprovement);
      }
      currentGeneration = nextGeneration;


      setGenerationNumber((num) => num + 1);
      
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    




//    setResultContext(resCtx);


    // start line sequence calculations
    // await lineSequenceCalculation(grayImg, pinCoords, lineCache, lineCacheLength, img.width);

    const timeEnd = performance.now();

    console.log("Time taken: " + (timeEnd - timeStart));
  } 

  const crossover = (parent1: Individual, parent2: Individual, numPins: number, numCrossoverPoints: number, grayImg: Uint8ClampedArray, lineCache: Map<string, Point[]>): Individual => {
    let segs = Array.from({ length: numPins }, (): number[] => []);

    const reduc = (prev: number, cur: number) => {
      segs[prev].push(cur);
      segs[cur].push(prev);
      return cur;
    };
    parent1.pinSequence.reduce(reduc);
    parent2.pinSequence.reduce(reduc);

    const childDna: number[] = [parent1.pinSequence.length];
    let i = 0;
    while(i <= parent1.pinSequence.length){
      const startPin = i === 0 ? parent1.pinSequence[0] : childDna[i-1];
      const segArr = segs[startPin];
      if(segArr.length === 0) continue;

      const idx = Math.floor(Math.random() * segArr.length);
      const endPin = segArr[idx];

      childDna[i] = endPin;
      i++;
      segArr.splice(idx, 1);
      const endArr = segs[endPin];
      endArr.splice(endArr.indexOf(startPin));
    }






    // const length = parent1.pinSequence.length;
    // const childDna: number[] = [];

    // // Generate N unique crossover points
    // const crossoverPoints = [];
    // while (crossoverPoints.length < numCrossoverPoints) {
    //     const rnd = Math.floor(Math.random() * (length - 2)) + 1; // from 1 to N - 1
    //     if (crossoverPoints.indexOf(rnd) === -1) crossoverPoints.push(rnd);
    // }
    // crossoverPoints.sort((a, b) => a - b);
  
    // let p1 = parent1;
    // let p2 = parent2;
    // // Generate child DNA with N crossover points
    // for (let i = 0, j = 0; i < length; i++) {
    //     if (i === crossoverPoints[j]) {
    //         j++;
    //         if(Math.abs(childDna[i - 1] - p2.pinSequence[i]) < MIN_DISTANCE) {
    //             childDna.push(generatePin(numPins, childDna[i - 1], p2.pinSequence[i + 1]));
    //         } else {
    //             childDna.push(p2.pinSequence[i]);
    //         }
    //         const pt = p1;
    //         p1 = p2;
    //         p2 = pt;
    //     } else {
    //         childDna.push(p1.pinSequence[i]);
    //     }
    // }

    const child: Individual = {
        pinSequence: childDna,
        fitness: 0      
    };
    child.data = mapPinsToData(child.pinSequence, grayImg, lineCache);
    return child;
}

  const mutate = (numPins: number, ind: Individual, mutationRate: number, lineCache: Map<string, Point[]>, grayImg: Uint8ClampedArray): void => {
    for(let i = 1; i < ind.pinSequence.length - 1; i++){
      if(Math.random() < mutationRate){
        addValueToPoints(getLine(lineCache, ind.pinSequence[i - 1], ind.pinSequence[i]), ind.data!, -LINE_WEIGHT);
        addValueToPoints(getLine(lineCache, ind.pinSequence[i + 1], ind.pinSequence[i]), ind.data!, -LINE_WEIGHT);

        ind.pinSequence[i] = getBestPin(ind.pinSequence[i - 1], ind.pinSequence[i + 1], numPins, lineCache, grayImg, ind.data!);

        addValueToPoints(getLine(lineCache, ind.pinSequence[i - 1], ind.pinSequence[i] ), ind.data!, LINE_WEIGHT);
        addValueToPoints(getLine(lineCache, ind.pinSequence[i + 1], ind.pinSequence[i] ), ind.data!, LINE_WEIGHT);
      }
    }
  }

  const getBestPin = (prevPin: number, nextPin: number, numPins: number, lineCache: Map<string, Point[]>, grayImg: Uint8ClampedArray, curImg: Uint8ClampedArray): number => {
      let minErr = Infinity;
      let bestPin = -1;
        
      for(let testPin = 0; testPin < numPins; testPin++){
        if(Math.min(Math.abs(prevPin - testPin),  numPins - Math.abs(prevPin - testPin)) < MIN_DISTANCE || Math.min(Math.abs(nextPin - testPin),  numPins - Math.abs(nextPin - testPin)) < MIN_DISTANCE) continue;
           
        let points = [...getLine(lineCache, testPin, prevPin), ...getLine(lineCache, testPin, nextPin)];
        
        let lineErr = points.map(p => Math.abs(grayImg[p.idx] - (curImg[p.idx] - LINE_WEIGHT))).reduce((prev, cur) => prev + cur, 0);
     
        lineErr = lineErr / points.length;
        if(lineErr < minErr){
          minErr = lineErr;
          bestPin = testPin;
        }
      }

      return bestPin;
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
      const x = Math.floor(center + radius * Math.cos(angle));
      const y = Math.floor(center + radius * Math.sin(angle));
      pinCoords.push({
        x,
        y,
        idx: y * length + x
      });
    }

    setPinCoordinates(pinCoords);
    return pinCoords;
  };

  const bresenhamLine = (x1: number, y1: number, x2: number, y2: number, dimension: number): Point[] => {
    const deltaX = Math.abs(x2 - x1);
    const deltaY = Math.abs(y2 - y1);
    const sx = (x1 < x2) ? 1 : -1;
    const sy = (y1 < y2) ? 1 : -1;
    let err = deltaX - deltaY;
  
    const points: Point[] = [];
  
    while(true) {
      points.push({ x: x1, y: y1, idx: y1 * dimension + x1 });
  
      if ((x1 === x2) && (y1 === y2)) break;
      let e2 = 2 * err;
      if (e2 > -deltaY) { err -= deltaY; x1 += sx; }
      if (e2 < deltaX) { err += deltaX; y1 += sy; }
    }
  
    return points;
  }

  const createBuffers = (pinCoords: Point[], dimension: number) => {
    let lineCache = new Map<string, Point[]>();
    // let lineCacheY = new Map<string, number[]>();
    let lineCacheLength = new Map<string, number>();
  
    for(let a=0; a<N_PINS; a++){
      for(let b=a+MIN_DISTANCE; b<N_PINS; b++){
        let { x: x0, y: y0,  } = pinCoords[a];
        let { x: x1, y: y1 } = pinCoords[b];
  
        let points = bresenhamLine(x0, y0, x1, y1, dimension);
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

  function mapPinsToData(pinSeq: number[], img: Uint8ClampedArray, lineCache: Map<string, Point[]>): Uint8ClampedArray {
    const arr = new Uint8ClampedArray(img.length).fill(255);
    for (let i = 0; i < pinSeq.length - 1; i++) {
      const startPin = pinSeq[i];
      const endPin = pinSeq[i + 1];

      const line = getLine(lineCache, startPin, endPin);

      addValueToPoints(line, arr, LINE_WEIGHT);
    }
    return arr;
  }

  function getLine(lineCache: Map<string, Point[]>, startPin: number, endPin: number): Point[] {
    return lineCache.get(`${startPin},${endPin}`)!;
  }

  function addValueToPoints(points: Point[], arr: Uint8ClampedArray, weight: number) {
    for (const point of points) {
      arr[point.idx] -= weight;
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
      {generationNumber && <span><br /><span>Generation Number: {generationNumber}<br /></span>
                                 <span>Generations without improvement: {gensWithoutImprovement} / {MAX_GENS_WITHOUT_IMPROVEMENT}<br /></span></span>}
      {bestInd && <span><h3>Best:</h3> <br /><span>Fitness: {bestInd.fitness}</span>
                              <br /><span>Pin Count: {bestInd.pinSequence.length}</span>
                              <br /><span>Pins: {bestInd.pinSequence.join(', ')}</span></span>}
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
  y: number,
  idx: number
};

type Pair = { pin1: number, pin2: number };
