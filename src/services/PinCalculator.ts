// self.addEventListener('message', (event: MessageEvent) => {


// });

//     async function lineSequenceCalculation(grayImg: ImageData, pinCoords: { x: number; y: number; }[],
//         lineCacheX: Map<string, number[]>, lineCacheY: Map<string, number[]>, lineCacheLength: Map<string, number>) : Promise<void> {
          
//         let lastPins: number[] = [];
          
//         let threadLength = 0;
         
//         let pin = 0;
//         let lineSequence: number[] = [pin];
         
//         const errorCanvas = document.createElement('canvas');
//         errorCanvas.width = grayImg.width;
//         errorCanvas.height = grayImg.height;
//         const errorCanvasCtx = errorCanvas.getContext('2d')!;
//         var error = errorCanvasCtx.createImageData(errorCanvas.width, errorCanvas.height);
//         for(let i = 0; i < grayImg.data.length; i += 4){
//           error.data[i] = 0xFF - grayImg.data[i]; // Using the red channel
//         }
        
//         const lineMaskCanvas = document.createElement('canvas');
//         lineMaskCanvas.width = grayImg.width;
//         lineMaskCanvas.height = grayImg.height;
//         const lineMaskCanvasCtx = lineMaskCanvas.getContext('2d')!;
//         let line_mask = lineMaskCanvasCtx.createImageData(grayImg.width, grayImg.height);
         
    
//         let result = document.createElement('canvas');
//         result.width = grayImg.width * SCALE;
//         result.height = grayImg.height * SCALE;
//         setResultCanvas(result);
    
//         let resCtx = result.getContext('2d')!;    
//         resCtx.fillStyle = '#FFFFFF';
//         resCtx.fillRect(0, 0, result.width, result.height);
//         setResultContext(resCtx);
    
//         const lineCache = new Set<string>();
      
        
    
//     for(let l=0; l<MAX_LINES; l++){
// if (l % 100 === 0) {
//     console.log(l);
//     // calculate the error and log it please
//   }
 
//   let maxErr = -Infinity;
//   let bestPin = -1;
    
//   for(let offset=MIN_DISTANCE; offset < N_PINS - MIN_DISTANCE; offset++){
//     let testPin = (pin + offset) % N_PINS;
//     if(/*lineCache.has(pin + '-' + testPin) ||*/ lastPins.includes(testPin)) continue;
       
//     let xs = lineCacheX.get(`${testPin},${pin}`)!;
//     let ys = lineCacheY.get(`${testPin},${pin}`)!;
       
//     let lineErr = 0;
//     for(let i=0; i<xs.length; i++){
//       lineErr += error.data[(ys[i]*error.width + xs[i])*4];
//     }
 
//     if(lineErr > maxErr){
//       maxErr = lineErr;
//       bestPin = testPin;
//     }
//   }
 
//   lineSequence.push(bestPin);
//   // lineCache.add(pin + "-" + bestPin);
 
//   let xs = lineCacheX.get(`${bestPin},${pin}`)!;
//   let ys = lineCacheY.get(`${bestPin},${pin}`)!;
//   let weight = LINE_WEIGHT;
 

//   for(let i=0; i<line_mask.data.length; i++){
//     line_mask.data[i] = 0;
//   }
  
 
//   for(let i=0; i<xs.length; i++){
//     let idx = (ys[i] * line_mask.width + xs[i]) * 4;
//     line_mask.data[idx] = weight; // Assuming the line_mask is only interested in the red channel
//   }
  
//   for(let i=0; i<xs.length; i++){
//     let idx = (ys[i] * line_mask.width + xs[i]) * 4;
//     error.data[idx] = clip(error.data[idx] - line_mask.data[idx], 0, 255);
//   }
  
  
 
//   // let threadPieceLength = Math.sqrt(Math.pow(pinCoords[bestPin].x - pinCoords[pin].x, 2)
//   //                      + Math.pow(pinCoords[bestPin].y - pinCoords[pin].y, 2));
 
//   // threadLength += HOOP_DIAMETER / length * threadPieceLength;
    
//   lastPins.push(bestPin);
//   if(lastPins.length > MIN_LOOP) lastPins.shift();
    
//   if(lineSequence.length % 100 === 0){
//     await new Promise(resolve => setTimeout(resolve, 100));
//   }
//   paint(bestPin, pin, pinCoords, result!, resCtx!);

//   pin = bestPin;       
  
//   setPinSequence([...lineSequence]);
// }} 
// };