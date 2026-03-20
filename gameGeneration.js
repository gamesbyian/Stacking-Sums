(function(global){
  const C = global.GAME_CONSTANTS;

  // ===== Generic RNG/math helpers (no game semantics) =====
  const randomInt = (min, max, rng = Math.random) => Math.floor(rng() * (max - min + 1)) + min;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
  const weightedPick = (weightedValues, rng = Math.random) => {
    const totalWeight = weightedValues.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = rng() * totalWeight;
    for (const entry of weightedValues) {
      roll -= entry.weight;
      if (roll <= 0) return entry.value;
    }
    return weightedValues[weightedValues.length - 1].value;
  };
  // ===== Difficulty & target distribution economy =====
  const getDifficulty = (rowsClearedTotal) => Math.min(rowsClearedTotal / C.TARGET_ROW_COUNT, 1);
  const softenLateWeight = (earlyWeight, lateWeight) => earlyWeight + ((lateWeight - earlyWeight) * C.TARGET_RAMP_SOFTENING);
  const targetBuckets={low:[1,5],lowMid:[6,12],mid:[13,18],high:[19,24],veryHigh:[25,28]};
  const bucketNames=Object.keys(targetBuckets);
  const getTargetWeights=(difficulty)=>{
    const early={low:0.15,lowMid:0.40,mid:0.28,high:0.12,veryHigh:0.05};
    const late={low:0.04,lowMid:0.24,mid:0.34,high:0.24,veryHigh:0.14};
    const softened=Object.fromEntries(Object.keys(early).map(k=>[k,softenLateWeight(early[k],late[k])]));
    return {
      low: lerp(early.low, softened.low, difficulty),
      lowMid: lerp(early.lowMid, softened.lowMid, difficulty),
      mid: lerp(early.mid, softened.mid, difficulty),
      high: lerp(early.high, softened.high, difficulty),
      veryHigh: lerp(early.veryHigh, softened.veryHigh, difficulty)
    };
  };
  const normalizeBucketWeights=(weights)=>{
    const total=Object.values(weights).reduce((s,w)=>s+w,0);
    if(total<=0) return weights;
    return Object.fromEntries(Object.entries(weights).map(([k,v])=>[k,v/total]));
  };
  const getBucketForTarget=(value)=>bucketNames.find((b)=>value>=targetBuckets[b][0]&&value<=targetBuckets[b][1])||null;
  const pickDifferentBucket=(weights,currentBucket,rng=Math.random)=>weightedPick(bucketNames.filter((b)=>b!==currentBucket).map((b)=>({value:b,weight:Math.max(weights[b]||0.01,0.01)})),rng);
  const generateTarget=(rowsClearedTotal=0,rng=Math.random)=>{
    const difficulty=getDifficulty(rowsClearedTotal); const w=normalizeBucketWeights(getTargetWeights(difficulty));
    const selected=weightedPick([{value:'low',weight:w.low},{value:'lowMid',weight:w.lowMid},{value:'mid',weight:w.mid},{value:'high',weight:w.high},{value:'veryHigh',weight:w.veryHigh}],rng);
    const [min,max]=targetBuckets[selected]; return randomInt(min,max,rng);
  };
  const generateTargetExcluding=(excludedValue,rowsClearedTotal=0,rng=Math.random)=>{let t=generateTarget(rowsClearedTotal,rng); while(t===excludedValue){t=generateTarget(rowsClearedTotal,rng);} return t;};

  // ===== Swap-specific target generation (board-aware) =====
  let lastSwapGenerationMode=null;
  const generateSwapReplacementTarget=(previousValue,rowsClearedTotal=0,grid=null,conveyor=null,swappedRowIndex=-1,rng=Math.random)=>{
    const difficulty=getDifficulty(rowsClearedTotal);
    const weights=normalizeBucketWeights(getTargetWeights(difficulty));
    const currentBucket=getBucketForTarget(previousValue);
    const fallback=()=>generateTargetExcluding(previousValue,rowsClearedTotal,rng);
    const chooseModeC=()=>{if(!currentBucket) return fallback(); for(let i=0;i<6;i++){const b=pickDifferentBucket(weights,currentBucket,rng); const [min,max]=targetBuckets[b]; const c=randomInt(min,max,rng); if(c!==previousValue) return c;} return fallback();};
    if(!grid||!conveyor||grid.length!==C.ROWS||conveyor.length!==C.ROWS){lastSwapGenerationMode='clean'; return chooseModeC();}
    const rowContext=[];
    for(let rowIndex=0;rowIndex<C.ROWS;rowIndex++){
      const row=grid[rowIndex]; const fillCount=row.reduce((n,cell)=>n+(cell!==null?1:0),0); if(!fillCount) continue;
      const sum=row.reduce((s,cell)=>s+(cell!==null?cell:0),0); const remainingCapacity=C.COLS-fillCount; const target=conveyor[rowIndex];
      rowContext.push({rowIndex,sum,fillCount,remainingCapacity,hasTiles:true,isDeadRow:(sum+remainingCapacity*9)<target});
    }
    const swappedRow=rowContext.find((r)=>r.rowIndex===swappedRowIndex)||null; const lowerRows=rowContext.filter((r)=>r.rowIndex>swappedRowIndex);
    const clutchWeight=lastSwapGenerationMode==='clutch'?0.035:0.07; const assistWeight=0.40; const cleanWeight=1-(clutchWeight+assistWeight);
    const selectedMode=weightedPick([{value:'clutch',weight:clutchWeight},{value:'assist',weight:assistWeight},{value:'clean',weight:cleanWeight}],rng);
    if(selectedMode==='clutch'&&swappedRow&&swappedRow.sum!==previousValue){lastSwapGenerationMode='clutch'; return swappedRow.sum;}
    if(selectedMode==='assist'){
      const assistCandidates=lowerRows.map((row)=>{let weight=1+row.fillCount*0.35; if(row.isDeadRow) weight+=5; weight+=(1/(row.remainingCapacity+0.75))*2.2; return {value:row,weight};});
      if(assistCandidates.length){const picked=weightedPick(assistCandidates,rng); if(picked.sum!==previousValue){lastSwapGenerationMode='assist'; return picked.sum;}}
    }
    lastSwapGenerationMode='clean'; return chooseModeC();
  };

  // ===== Tile generation (includes board-aware soft assistance) =====
  const generateTile=({rowsClearedTotal=0,grid=null,conveyor=null,recentTiles=[]}={},rng=Math.random)=>{
    const base=[{value:0,weight:7},{value:1,weight:12},{value:2,weight:12},{value:3,weight:11},{value:4,weight:10},{value:5,weight:9},{value:6,weight:8},{value:7,weight:5},{value:8,weight:4},{value:9,weight:3}].map((e)=>({...e}));
    const adjust=(v,f)=>{const found=base.find((e)=>e.value===v); if(found) found.weight=Math.max(0.1,found.weight*f);};
    if(grid&&conveyor&&grid.length===C.ROWS&&conveyor.length===C.ROWS){
      const near=[]; for(let rowIndex=0;rowIndex<C.ROWS;rowIndex++){const row=grid[rowIndex]; const has=row.some((c)=>c!==null); if(!has) continue; const filled=row.reduce((n,c)=>n+(c!==null?1:0),0); const rem=C.COLS-filled; if(rem<1) continue; const sum=row.reduce((s,c)=>s+(c!==null?c:0),0); const diff=conveyor[rowIndex]-sum; if(diff>=1&&diff<=7){near.push({needed:diff,weight:(8-diff)*1.8+((rowIndex+1)*0.08)});}}
      if(near.length>0&&rng()<0.24){const selected=weightedPick(near.map((r)=>({value:r,weight:r.weight})),rng); [clamp(selected.needed-1,0,9),clamp(selected.needed,0,9),clamp(selected.needed+1,0,9)].forEach((v)=>adjust(v,1.45));}
    }
    if(rowsClearedTotal>=16&&recentTiles.length>=8){const windowTiles=recentTiles.slice(-10); const avg=windowTiles.reduce((s,v)=>s+v,0)/windowTiles.length; const diff=getDifficulty(rowsClearedTotal); if(avg<2.9+(diff*1.4)){adjust(0,0.92);adjust(1,0.88);adjust(2,0.88);[5,6,7,8].forEach((v)=>adjust(v,1.12));}}
    return weightedPick(base,rng);
  };

  // ===== Conveyor bootstrap helpers =====
  const createConveyorTargets=(rowsClearedTotal=0,rng=Math.random)=>{const targets=[]; for(let i=0;i<C.ROWS;i++){targets.push(generateTargetExcluding(i>0?targets[i-1]:null,rowsClearedTotal,rng));} return targets;};

  global.GameGeneration={randomInt,lerp,weightedPick,clamp,getDifficulty,generateTile,generateTarget,generateTargetExcluding,generateSwapReplacementTarget,createConveyorTargets,getLastSwapGenerationMode:()=>lastSwapGenerationMode,resetLastSwapGenerationMode:()=>{lastSwapGenerationMode=null;}};
})(window);
