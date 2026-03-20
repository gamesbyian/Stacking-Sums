(function(global){
  const C=global.GAME_CONSTANTS;
  const G=global.GameGeneration;
  const S=global.GameScoring;

  /*
   * Model API (pure game rules, no React/timers/DOM):
   * - createInitialGameState
   * - cloneGameState
   * - simulateDirectDrop / applyDirectDrop
   * - advanceConveyorState
   * - resolveSingleMatchStep / resolveAllVisibleMatches / resolveVisibleMatches
   * - applySwap / canSwapRow
   * - tickSwapRegen
   * - applyAction
   */
  const createEmptyGrid=()=>Array.from({length:C.ROWS},()=>Array(C.COLS).fill(null));
  const cloneGrid=(grid)=>grid.map((r)=>[...r]);
  const cloneGameState=(state)=>({...state,grid:cloneGrid(state.grid),queue:[...state.queue],conveyor:[...state.conveyor]});

  const createInitialGameState=({mode='direct',rng=Math.random}={})=>{
    const conveyor=G.createConveyorTargets(0,rng);
    return {
      grid:createEmptyGrid(),
      queue:[G.generateTile({},rng),G.generateTile({},rng)],
      conveyor,
      incomingTarget:G.generateTargetExcluding(conveyor[0],0,rng),
      mode,
      gameOver:false,
      score:0,
      rowsClearedTotal:0,
      advanceCount:0,
      swapsAvailable:C.SWAP_START,
      swapRegenElapsedMs:0
    };
  };

  const getLandingRowForColumn=(stateOrGrid,col)=>{
    const grid=Array.isArray(stateOrGrid)?stateOrGrid:stateOrGrid.grid;
    for(let r=C.ROWS-1;r>=0;r--){if(grid[r][col]===null) return r;} return -1;
  };
  const getLegalDirectDropColumns=(stateOrGrid)=>{const grid=Array.isArray(stateOrGrid)?stateOrGrid:stateOrGrid.grid; const cols=[]; for(let c=0;c<C.COLS;c++){if(getLandingRowForColumn(grid,c)!==-1) cols.push(c);} return cols;};
  const simulateDirectDrop=(state,col,valToDrop=state.queue[0])=>{
    const landingRow=getLandingRowForColumn(state,col); if(landingRow===-1) return null;
    const nextState=cloneGameState(state); nextState.grid[landingRow][col]=valToDrop;
    return {nextState,landingRow,colIndex:col,droppedValue:valToDrop};
  };
  const applyDirectDrop=(state,col,rng=Math.random)=>{
    const sim=simulateDirectDrop(state,col,state.queue[0]); if(!sim) return {applied:false,nextState:cloneGameState(state)};
    const next=sim.nextState; next.queue=[state.queue[1],G.generateTile({rowsClearedTotal:state.rowsClearedTotal,grid:next.grid,conveyor:state.conveyor,recentTiles:[...state.queue]},rng)];
    next.gameOver=next.grid[0].every((cell)=>cell!==null);
    return {applied:true,nextState:next,landingRow:sim.landingRow,colIndex:col};
  };

  const findMatchingRows=(stateOrGrid,sourceConveyor)=>{
    const grid=Array.isArray(stateOrGrid)?stateOrGrid:stateOrGrid.grid;
    const conveyor=sourceConveyor||stateOrGrid.conveyor;
    const matches=[]; for(let r=0;r<C.ROWS;r++){const has=grid[r].some((cell)=>cell!==null); if(!has) continue; const sum=grid[r].reduce((s,cell)=>s+(cell!==null?cell:0),0); if(sum===conveyor[r]) matches.push(r);} return matches;
  };

  const collapseGridForClearedRows=(grid,rows)=>{if(!rows.length) return cloneGrid(grid); const next=grid.filter((_,idx)=>!rows.includes(idx)).map((r)=>[...r]); for(let i=0;i<rows.length;i++) next.unshift(Array(C.COLS).fill(null)); return next;};

  const rowHasTiles=(grid,row)=>grid[row].some((cell)=>cell!==null);
  const rowSum=(grid,row)=>grid[row].reduce((s,cell)=>s+(cell!==null?cell:0),0);
  const getConveyorValueAfterOneStep=(conveyor,incoming,row)=>row===0?incoming:conveyor[row-1];
  const findContiguousSameSumBlock=(grid,startRow,targetValue)=>{
    if(startRow<0||startRow>=C.ROWS) return null; if(!rowHasTiles(grid,startRow)) return null; if(rowSum(grid,startRow)!==targetValue) return null;
    const prev=startRow-1; const previousIsSame=prev>=0&&rowHasTiles(grid,prev)&&rowSum(grid,prev)===targetValue; if(previousIsSame) return null;
    let endRow=startRow; while(endRow+1<C.ROWS){const next=endRow+1; if(!rowHasTiles(grid,next)||rowSum(grid,next)!==targetValue) break; endRow=next;}
    return {startRow,endRow,length:endRow-startRow+1,sum:targetValue};
  };
  const getConveyorAdvanceDistance=(grid,conveyor,incoming)=>{for(let row=0;row<C.ROWS;row++){const t=getConveyorValueAfterOneStep(conveyor,incoming,row); const block=findContiguousSameSumBlock(grid,row,t); if(block&&block.length>=2) return {distance:block.length,block};} return {distance:1,block:null};};
  const advanceConveyorState=(state,rng=Math.random)=>{
    const {distance:shiftCount,block}=getConveyorAdvanceDistance(state.grid,state.conveyor,state.incomingTarget);
    let nextConveyor=[...state.conveyor]; let nextIncoming=state.incomingTarget;
    for(let i=0;i<shiftCount;i++){nextConveyor=[nextIncoming,...nextConveyor.slice(0,-1)]; nextIncoming=G.generateTargetExcluding(nextConveyor[0],state.rowsClearedTotal,rng);}
    const next=cloneGameState(state); next.conveyor=nextConveyor; next.incomingTarget=nextIncoming; next.advanceCount=state.advanceCount+shiftCount;
    const matchingRows=findMatchingRows(next.grid,nextConveyor);
    return {nextState:next,shiftDistance:shiftCount,matchingRows,block};
  };

  const resolveSingleMatchStep=(state)=>{
    const matchingRows=findMatchingRows(state);
    if(!matchingRows.length){
      return {nextState:cloneGameState(state),didClear:false,rowsCleared:[],scoreDelta:0,seriesBonusCount:0,allClear:false};
    }
    const next=cloneGameState(state);
    const seriesBonusCount=matchingRows.reduce((count,rowIndex)=>(S.qualifiesForSeriesBonus(next.grid[rowIndex],next.conveyor[rowIndex])?count+1:count),0);
    const cascadeScore=S.getCascadeScore(matchingRows.length);
    const seriesBonusScore=seriesBonusCount*C.SERIES_BONUS_POINTS;
    const collapsedGrid=collapseGridForClearedRows(next.grid,matchingRows);
    const allClear=S.isAllClear(collapsedGrid);
    const allClearBonus=allClear?C.ALL_CLEAR_BONUS_POINTS:0;
    const scoreDelta=cascadeScore+seriesBonusScore+allClearBonus;
    next.grid=collapsedGrid;
    next.rowsClearedTotal+=matchingRows.length;
    next.score+=scoreDelta;
    return {nextState:next,didClear:true,rowsCleared:matchingRows,scoreDelta,seriesBonusCount,allClear};
  };

  // Computes the full logical clear chain headlessly; UI can animate the returned steps however it wants.
  const resolveAllVisibleMatches=(state)=>{
    let working=cloneGameState(state);
    const steps=[];
    let totalScoreDelta=0;
    let totalRowsCleared=0;
    while(true){
      const step=resolveSingleMatchStep(working);
      if(!step.didClear) break;
      steps.push({
        rowsCleared:step.rowsCleared,
        scoreDelta:step.scoreDelta,
        seriesBonusCount:step.seriesBonusCount,
        allClear:step.allClear,
        intermediateState:cloneGameState(step.nextState)
      });
      totalScoreDelta+=step.scoreDelta;
      totalRowsCleared+=step.rowsCleared.length;
      working=step.nextState;
    }
    return {finalState:working,steps,totalScoreDelta,totalRowsCleared};
  };

  const canSwapRow=(state,rowIndex)=>state.swapsAvailable>0&&!state.gameOver&&rowIndex>=0&&rowIndex<C.ROWS;
  const applySwap=(state,rowIndex,rng=Math.random)=>{
    if(!canSwapRow(state,rowIndex)) return {applied:false,nextState:cloneGameState(state)};
    const next=cloneGameState(state); const oldTarget=next.conveyor[rowIndex];
    const replacement=G.generateSwapReplacementTarget(oldTarget,next.rowsClearedTotal,next.grid,next.conveyor,rowIndex,rng);
    next.conveyor[rowIndex]=replacement; next.swapsAvailable=Math.max(0,next.swapsAvailable-1); if(state.swapsAvailable===C.SWAP_CAP) next.swapRegenElapsedMs=0;
    return {applied:true,nextState:next,rowIndex,oldTarget,replacement};
  };

  const tickSwapRegen=(state,elapsedMs)=>{
    const next=cloneGameState(state);
    if(next.swapsAvailable>=C.SWAP_CAP){next.swapRegenElapsedMs=C.SWAP_REGEN_MS; return {nextState:next,didRegen:false};}
    const updated=next.swapRegenElapsedMs+elapsedMs;
    if(updated>=C.SWAP_REGEN_MS){next.swapsAvailable=Math.min(C.SWAP_CAP,next.swapsAvailable+1); next.swapRegenElapsedMs=0; return {nextState:next,didRegen:true};}
    next.swapRegenElapsedMs=updated; return {nextState:next,didRegen:false};
  };

  const getTickDuration=(stateOrAdvances)=>{const advances=typeof stateOrAdvances==='number'?stateOrAdvances:stateOrAdvances.advanceCount; const t=Math.min(advances/C.TICK_RAMP_ADVANCES,1); return Math.round(C.MAX_TICK_MS-(C.MAX_TICK_MS-C.MIN_TICK_MS)*t);};
  const resolveVisibleMatches=(state)=>resolveSingleMatchStep(state);

  const simulateWait=(state,rng=Math.random)=>{
    const advance=advanceConveyorState(state,rng);
    const matchingRowsBeforeResolution=[...advance.matchingRows];
    const resolved=resolveAllVisibleMatches(advance.nextState);
    const scoreDelta=resolved.totalScoreDelta;
    const rowsCleared=resolved.steps.reduce((sum,step)=>sum+step.rowsCleared.length,0);
    const seriesBonusCount=resolved.steps.reduce((sum,step)=>sum+step.seriesBonusCount,0);
    const allClear=resolved.steps.some((step)=>step.allClear);
    return {
      nextState:resolved.finalState,
      shiftDistance:advance.shiftDistance,
      matchingRowsBeforeResolution,
      rowsCleared,
      scoreDelta,
      allClear,
      seriesBonusCount,
      block:advance.block,
      resolutionSteps:resolved.steps
    };
  };

  // Thin action-style reducer: orchestration/replay entry point built on the same pure primitives.
  const applyAction=(state,action,rng=Math.random)=>{
    if(!action||!action.type) return {applied:false,nextState:cloneGameState(state),action};
    switch(action.type){
      case 'DROP_TILE': {
        const drop=applyDirectDrop(state,action.column,rng);
        return {...drop,action};
      }
      case 'ADVANCE_CONVEYOR': {
        const advance=advanceConveyorState(state,rng);
        return {applied:true,nextState:advance.nextState,action,meta:{shiftDistance:advance.shiftDistance,matchingRows:advance.matchingRows,block:advance.block}};
      }
      case 'APPLY_SWAP': {
        const swap=applySwap(state,action.rowIndex,rng);
        return {...swap,action};
      }
      case 'TICK_SWAP_REGEN': {
        const tick=tickSwapRegen(state,action.elapsedMs||0);
        return {applied:true,nextState:tick.nextState,action,meta:{didRegen:tick.didRegen}};
      }
      default:
        return {applied:false,nextState:cloneGameState(state),action};
    }
  };

  global.GameModel={createEmptyGrid,createInitialGameState,cloneGameState,getLandingRowForColumn,getLegalDirectDropColumns,simulateDirectDrop,applyDirectDrop,findMatchingRows,collapseGridForClearedRows,getConveyorValueAfterOneStep,findContiguousSameSumBlock,getConveyorAdvanceDistance,resolveSingleMatchStep,resolveAllVisibleMatches,resolveVisibleMatches,advanceConveyorState,simulateWait,canSwapRow,applySwap,tickSwapRegen,applyAction,getTickDuration,qualifiesForSeriesBonus:S.qualifiesForSeriesBonus,isAllClear:S.isAllClear};
})(window);
