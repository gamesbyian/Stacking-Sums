(function(global){
  const C=global.GAME_CONSTANTS;
  const M=global.GameModel;

  const chooseBestDrop=(gameState,evaluateDrop)=>{
    const legalCols=M.getLegalDirectDropColumns(gameState);
    if(!legalCols.length) return {type:'drop',col:-1,score:Number.NEGATIVE_INFINITY,reason:'no-legal-drop'};
    let bestAction={type:'drop',col:legalCols[0],score:Number.NEGATIVE_INFINITY,reason:'drop'};
    legalCols.forEach((col)=>{
      const currentSim=M.simulateDirectDrop(gameState,col,gameState.queue[0]);
      const currentScore=evaluateDrop(gameState,currentSim,gameState.queue[0],gameState.queue[1]);
      let combinedScore=currentScore*C.DEMO_IMMEDIATE_FACTOR;
      if(gameState.queue[1]!==undefined&&gameState.queue[1]!==null&&currentSim){
        const lookaheadState=currentSim.nextState;
        const nextLegalCols=M.getLegalDirectDropColumns(lookaheadState);
        let nextBest=Number.NEGATIVE_INFINITY;
        nextLegalCols.forEach((nextCol)=>{
          const nextSim=M.simulateDirectDrop(lookaheadState,nextCol,gameState.queue[1]);
          const nextScore=evaluateDrop(lookaheadState,nextSim,gameState.queue[1],null);
          if(nextScore>nextBest) nextBest=nextScore;
        });
        if(nextBest!==Number.NEGATIVE_INFINITY) combinedScore+=nextBest*C.DEMO_LOOKAHEAD_FACTOR;
      }
      if(combinedScore>bestAction.score){
        bestAction={type:'drop',col,score:combinedScore,reason:'best-drop'};
      }
    });
    return bestAction;
  };

  const chooseDemoAction=(gameState,helpers={})=>{
    const evaluateDrop=helpers.evaluateDrop||(()=>Number.NEGATIVE_INFINITY);
    const evaluateWait=helpers.evaluateWait||(()=>Number.NEGATIVE_INFINITY);
    const includeWait=helpers.includeWait!==false;
    const dropAction=chooseBestDrop(gameState,evaluateDrop);
    if(!includeWait){
      return {action:dropAction,bestDrop:dropAction,waitAction:null};
    }
    const waitSimulation=M.simulateWait(gameState);
    const waitScore=evaluateWait(gameState,waitSimulation);
    const waitAction={type:'wait',score:waitScore,reason:'evaluated-wait',simulation:waitSimulation};
    const action=waitAction.score>dropAction.score?waitAction:dropAction;
    return {action,bestDrop:dropAction,waitAction};
  };

  const chooseDemoColumn=(gameState,evaluateMove)=>{
    const result=chooseDemoAction(gameState,{evaluateDrop:evaluateMove,includeWait:false});
    return {col:result.bestDrop.col,score:result.bestDrop.score};
  };

  global.GameDemo={chooseDemoAction,chooseDemoColumn};
})(window);
