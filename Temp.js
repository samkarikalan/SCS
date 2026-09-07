function mbmBestGame(pool, waitQueue, state) {

    const pairHistory = state.pairPlayedSet || new Set();
    const opponentMap = state.opponentMap || {};

    const playedPairs = (a,b) => {
        return pairHistory.has(pairKey(a,b));
    };


    const freshOpp = (a,b) => {
        return !(
            (opponentMap[a] && opponentMap[a][b]) ||
            (opponentMap[b] && opponentMap[b][a])
        );
    };


    const waitValue = (players) => {
        let v = 0;

        players.forEach(p => {
            const idx = waitQueue.indexOf(p);
            if(idx >= 0)
                v += waitQueue.length - idx;
        });

        return v;
    };


    let allCandidates = [];
    let uniqueCandidates = [];


    for(let i=0;i<pool.length;i++){

        for(let j=i+1;j<pool.length;j++){

            let p1=[pool[i],pool[j]];


            for(let k=0;k<pool.length;k++){

                if(k===i || k===j) continue;


                for(let l=k+1;l<pool.length;l++){

                    if(l===i || l===j) continue;


                    let p2=[pool[k],pool[l]];


                    // avoid duplicate pair ordering
                    let key=[
                        pairKey(p1[0],p1[1]),
                        pairKey(p2[0],p2[1])
                    ].sort().join("|");


                    if(allCandidates.some(x=>x.key===key))
                        continue;


                    let item={
                        key,
                        pair1:p1,
                        pair2:p2
                    };


                    allCandidates.push(item);


                    if(
                        !playedPairs(p1[0],p1[1]) &&
                        !playedPairs(p2[0],p2[1])
                    ){
                        uniqueCandidates.push(item);
                    }
                }
            }
        }
    }



    // first priority: both pairs never played
    let candidates =
        uniqueCandidates.length
        ? uniqueCandidates
        : allCandidates;



    let best=null;


    for(const c of candidates){

        let opp=0;

        for(const a of c.pair1)
            for(const b of c.pair2)
                if(freshOpp(a,b))
                    opp++;


        let partner =
            (!playedPairs(c.pair1[0],c.pair1[1]) ? 1:0) +
            (!playedPairs(c.pair2[0],c.pair2[1]) ? 1:0);


        let wait =
            waitValue([
                ...c.pair1,
                ...c.pair2
            ]);


        let score={
            opp,
            partner,
            wait
        };


        if(
            !best ||
            score.opp > best.score.opp ||
            (
              score.opp===best.score.opp &&
              score.partner > best.score.partner
            ) ||
            (
              score.opp===best.score.opp &&
              score.partner===best.score.partner &&
              score.wait > best.score.wait
            )
        ){

            best={
                pair1:c.pair1,
                pair2:c.pair2,
                score
            };
        }
    }


    return best
        ? {
            pair1:best.pair1,
            pair2:best.pair2
          }
        : null;
}
