document.addEventListener('DOMContentLoaded', () => {

    const form = document.getElementById('hand-recorder-form');
    // 標準德州撲克順序：翻牌前 UTG 先走，翻牌後 SB 先走
    const preflopOrder = ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
    const postFlopOrder = ['SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN'];

    function formatPot(num) {
        return Number.isInteger(num) ? num : num.toFixed(2);
    }

    let isCalculating = false;
    let pendingCalculation = false;

    // 核心觸發器：防止重複調用的鎖定機制
    function requestCalculatePot() {
        if (isCalculating) {
            pendingCalculation = true;
            return;
        }
        isCalculating = true;
        calculatePot();
        isCalculating = false;

        if (pendingCalculation) {
            pendingCalculation = false;
            requestCalculatePot();
        }
    }

    function createActionRow(street) {
        const actionList = document.getElementById(`action-list-${street}`);
        if (!actionList) return;

        // 隨機動態 ID 保證唯一性
        const actionCount = Date.now() + Math.floor(Math.random() * 1000);
        const actionItem = document.createElement('div');
        actionItem.className = 'action-item';

        const posSelect = document.createElement('select');
        posSelect.name = `action_pos_${street}_${actionCount}`;

        const actSelect = document.createElement('select');
        actSelect.name = `action_type_${street}_${actionCount}`;

        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = 'Action...';
        defaultOpt.selected = true;
        actSelect.appendChild(defaultOpt);

        // 初始可選項，稍後會被自動邏輯覆寫過濾
        ['Fold', 'Check', 'Call', 'Bet', 'Raise', 'All-in'].forEach(a => {
            const opt = document.createElement('option');
            opt.value = a;
            opt.textContent = a;
            actSelect.appendChild(opt);
        });

        const amountInput = document.createElement('input');
        amountInput.type = 'number';
        amountInput.step = 'any';
        amountInput.name = `action_amount_${street}_${actionCount}`;
        amountInput.placeholder = 'Chips';
        amountInput.min = '0';
        amountInput.style.visibility = 'hidden';

        const potBadge = document.createElement('div');
        potBadge.className = 'action-pot-badge';
        potBadge.innerHTML = `Pot: <span>...</span>`;

        actSelect.addEventListener('change', () => {
            const val = actSelect.value;
            if (val === '' || val === 'Fold' || val === 'Check' || val === 'Call') {
                amountInput.style.visibility = 'hidden';
                amountInput.value = '';
            } else {
                amountInput.style.visibility = 'visible';
            }
        });

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-action-btn';
        removeBtn.innerHTML = '✕';
        removeBtn.addEventListener('click', () => {
            actionItem.style.opacity = '0';
            actionItem.style.transform = 'translateY(-10px)';
            setTimeout(() => {
                actionItem.remove();
                requestCalculatePot();
            }, 200);
        });

        actionItem.appendChild(posSelect);
        actionItem.appendChild(actSelect);
        actionItem.appendChild(amountInput);
        actionItem.appendChild(potBadge);
        actionItem.appendChild(removeBtn);

        actionList.appendChild(actionItem);
    }

    // -------------------------------------------------------------
    // Pot & Auto-Position Simulator Logic
    // -------------------------------------------------------------
    function calculatePot() {
        let pot = 0;
        let needsReCalc = false;

        const blindsInput = document.getElementById('blinds')?.value || '';
        const blindMatches = blindsInput.match(/\d+(\.\d+)?/g);
        let playerCommitted = {};
        let playerTotalInvested = {}; // 新增：用於精準計算 Side Pot 的總投入額跟蹤
        let currentStreetBet = 0;

        // 1. 初始化盲注
        if (blindMatches && blindMatches.length > 0) {
            const blinds = blindMatches.map(Number);
            pot = blinds.reduce((a, b) => a + b, 0);

            if (blinds.length >= 2) {
                playerCommitted['SB'] = blinds[blinds.length - 2];
                playerCommitted['BB'] = blinds[blinds.length - 1];
                playerTotalInvested['SB'] = blinds[blinds.length - 2];
                playerTotalInvested['BB'] = blinds[blinds.length - 1];
                currentStreetBet = blinds[blinds.length - 1];
            } else if (blinds.length === 1) {
                playerCommitted['BB'] = blinds[0];
                playerTotalInvested['BB'] = blinds[0];
                currentStreetBet = blinds[0];
            }
        }

        const preflopStart = document.getElementById('pot-start-preflop');
        if (preflopStart) preflopStart.textContent = formatPot(pot);

        // 自動替 Preflop 綁定第一行
        const preflopList = document.getElementById('action-list-preflop');
        if (preflopList && preflopList.children.length === 0) {
            createActionRow('preflop');
            needsReCalc = true;
        }

        const streets = ['preflop', 'flop', 'turn', 'river'];
        let globalFolded = new Set();
        let globalAllIn = new Set();
        let skipFurtherActions = false; // 新增：若只剩1人（或0人）可行動，直接停止生成動作輸入框

        streets.forEach((street, index) => {
            const isPreflop = (street === 'preflop');
            if (!isPreflop) {
                currentStreetBet = 0;
                preflopOrder.forEach(p => {
                    if (globalFolded.has(p)) {
                        delete playerCommitted[p];
                    } else {
                        // 包含 All-in 玩家的 committed 也要歸 0 （他這輪不該下注）
                        playerCommitted[p] = 0;
                    }
                });
            }

            const orderArray = isPreflop ? preflopOrder : postFlopOrder;
            // 該街真正可以 "被動或主動決定行動" 的名單：不含蓋牌、不含已 All-in 的人
            let active = orderArray.filter(p => !globalFolded.has(p) && !globalAllIn.has(p));
            if (skipFurtherActions) active = []; // 阻斷幽靈輸入框
            let streetClosed = new Set();

            let turnIndex = 0;
            let actionComplete = false;
            let hasWaitingAction = false;
            let playersActedThisStreet = new Set();

            const actionList = document.getElementById(`action-list-${street}`);
            let actionItemsCount = 0;

            if (actionList) {
                const actionItems = actionList.querySelectorAll('.action-item');

                for (let i = 0; i < actionItems.length; i++) {
                    const item = actionItems[i];
                    if (actionComplete) {
                        item.style.display = 'none';
                        continue;
                    } else {
                        item.style.display = 'grid';
                    }

                    const posSelect = item.querySelector('select[name^="action_pos"]');
                    const actSelect = item.querySelector('select[name^="action_type"]');
                    const amtInput = item.querySelector('input[name^="action_amount"]');

                    if (!posSelect || !actSelect || !amtInput) continue;

                    // 2. 核心：自動推算合法座位
                    let currentPos = '';
                    if (active.length > 0) {
                        if (isPreflop) {
                            // PREFLOP: 開放手動選直接跳位（跳過的人算入隱含蓋牌）
                            posSelect.removeAttribute('disabled');
                            posSelect.style.appearance = '';
                            posSelect.style.backgroundColor = 'rgba(15, 23, 42, 0.6)';
                            posSelect.style.border = '1px solid var(--panel-border)';
                            posSelect.style.color = 'var(--text-main)';
                            posSelect.style.fontWeight = 'normal';
                            posSelect.style.padding = '0.75rem 1rem';

                            const validPositions = preflopOrder.filter(p => !globalFolded.has(p) && !streetClosed.has(p) && !globalAllIn.has(p));
                            const currentlySelected = posSelect.value;

                            posSelect.innerHTML = '';
                            if (validPositions.length === 0) {
                                const opt = document.createElement('option');
                                opt.value = currentlySelected || '';
                                opt.textContent = currentlySelected || 'None';
                                posSelect.appendChild(opt);
                            } else {
                                validPositions.forEach(p => {
                                    const opt = document.createElement('option');
                                    opt.value = p;
                                    opt.textContent = p;
                                    posSelect.appendChild(opt);
                                });
                                if (validPositions.includes(currentlySelected)) {
                                    posSelect.value = currentlySelected;
                                } else {
                                    posSelect.value = active[turnIndex % active.length] || validPositions[0];
                                }
                            }
                            currentPos = posSelect.value;

                            let pointer = turnIndex % active.length;
                            let guard = 0;
                            while (active.length > 0 && active[pointer] !== currentPos && guard < 20) {
                                const skippedPlayer = active[pointer];
                                globalFolded.add(skippedPlayer);
                                active = active.filter(p => p !== skippedPlayer);
                                pointer = pointer % active.length;
                                guard++;
                            }
                            turnIndex = pointer;

                        } else {
                            // POSTFLOP: 無腦全自動代入
                            currentPos = active[turnIndex % active.length];

                            posSelect.innerHTML = '';
                            const opt = document.createElement('option');
                            opt.value = currentPos;
                            opt.textContent = currentPos;
                            posSelect.appendChild(opt);
                            posSelect.value = currentPos;

                            posSelect.setAttribute('disabled', 'true');
                            posSelect.style.appearance = 'none';
                            posSelect.style.backgroundColor = 'transparent';
                            posSelect.style.border = 'none';
                            posSelect.style.color = 'var(--primary)';
                            posSelect.style.fontWeight = 'bold';
                            posSelect.style.padding = '0';
                            posSelect.style.opacity = '1';
                        }
                    }

                    if (!currentPos) continue;

                    // 邏輯: 計算這位玩家面臨的下注壓力，並動態過濾不合法的動作
                    const committedForCheck = playerCommitted[currentPos] || 0;
                    const facingBet = currentStreetBet - committedForCheck;

                    const currentAct = actSelect.value;
                    let allowedActions = [''];

                    if (facingBet > 0) {
                        // 面臨下注壓力時：只能蓋牌、跟注、加注或 All-in (不會有 Check 與 Bet)
                        allowedActions.push('Fold');
                        allowedActions.push('Call');
                        allowedActions.push('Raise');
                        allowedActions.push('All-in');
                    } else {
                        // 沒有壓力時 (自己是第一位，或前面全部 Check)：不准無腦蓋牌
                        allowedActions.push('Check');
                        allowedActions.push('All-in'); // 開局就 All-in 當作第一注

                        if (isPreflop) {
                            allowedActions.push('Raise'); // Preflop BB 面對所有人 Call 進來時的起手式叫 Raise
                        } else {
                            allowedActions.push('Bet'); // Postflop 首位主動下注叫 Bet
                        }
                    }

                    actSelect.innerHTML = '';
                    allowedActions.forEach(a => {
                        const opt = document.createElement('option');
                        opt.value = a;
                        opt.textContent = a === '' ? 'Action...' : a;
                        actSelect.appendChild(opt);
                    });

                    // 如果歷史修正導致此動作不再合法，強制抹除退回 Action...
                    if (allowedActions.includes(currentAct)) {
                        actSelect.value = currentAct;
                    } else {
                        actSelect.value = '';
                    }

                    const act = actSelect.value;

                    // 視覺反饋強制對齊計算結果
                    if (act === '' || act === 'Fold' || act === 'Check' || act === 'Call') {
                        amtInput.style.visibility = 'hidden';
                    } else {
                        amtInput.style.visibility = 'visible';
                    }

                    if (act === '') {
                        hasWaitingAction = true;

                        // 清理底層因邏輯變化不再需要/不合法的多餘動作
                        for (let j = i + 1; j < actionItems.length; j++) {
                            actionItems[j].remove();
                        }

                        // 此動作還沒確認，底池先給未定
                        const badgeSpan = item.querySelector('.action-pot-badge span');
                        if (badgeSpan) badgeSpan.textContent = '...';

                        break;
                    }

                    actionItemsCount++;
                    const amt = parseFloat(amtInput.value) || 0;
                    const committed = playerCommitted[currentPos] || 0;

                    playersActedThisStreet.add(currentPos);

                    if (act === 'Fold') {
                        globalFolded.add(currentPos);
                        active = active.filter(p => p !== currentPos);
                        item.setAttribute('data-computed-amt', 0);
                    } else if (act === 'All-in') {
                        globalAllIn.add(currentPos);
                        active = active.filter(p => p !== currentPos);
                        if (amt > committed) {
                            pot += (amt - committed);
                            playerTotalInvested[currentPos] = (playerTotalInvested[currentPos] || 0) + (amt - committed);
                            playerCommitted[currentPos] = amt;
                            if (amt > currentStreetBet) {
                                currentStreetBet = amt;
                            }
                        }
                        item.setAttribute('data-computed-amt', amt);
                    } else {
                        if (act === 'Check' || act === 'Call') {
                            streetClosed.add(currentPos);
                            let toCall = 0;
                            if (act === 'Call') {
                                toCall = currentStreetBet - committed;
                                if (toCall > 0) {
                                    pot += toCall;
                                    playerTotalInvested[currentPos] = (playerTotalInvested[currentPos] || 0) + toCall;
                                    playerCommitted[currentPos] = currentStreetBet;
                                }
                                item.setAttribute('data-computed-amt', currentStreetBet);
                            } else {
                                item.setAttribute('data-computed-amt', 0);
                            }
                        } else if (act === 'Bet' || act === 'Raise') {
                            streetClosed.clear();
                            streetClosed.add(currentPos);
                            if (amt > committed) {
                                pot += (amt - committed);
                                playerTotalInvested[currentPos] = (playerTotalInvested[currentPos] || 0) + (amt - committed);
                                playerCommitted[currentPos] = amt;
                                if (amt > currentStreetBet) {
                                    currentStreetBet = amt; // Update to higher bet
                                }
                            }
                            item.setAttribute('data-computed-amt', amt);
                        }
                        turnIndex = (turnIndex + 1) % active.length;
                    }

                    const badgeSpan = item.querySelector('.action-pot-badge span');
                    if (badgeSpan) badgeSpan.textContent = formatPot(pot);

                    // 判斷這一街是否 "數學上已經完結"
                    if (active.length === 0) {
                        actionComplete = true;
                    } else if (active.length === 1) {
                        const sole = active[0];
                        const isMatched = (playerCommitted[sole] || 0) === currentStreetBet;
                        const hasActed = playersActedThisStreet.has(sole);
                        if (isMatched && hasActed) {
                            actionComplete = true;
                        }
                    } else {
                        const allMatched = active.every(p => (playerCommitted[p] || 0) === currentStreetBet);
                        const allActed = active.every(p => playersActedThisStreet.has(p));
                        if (allMatched && allActed) {
                            actionComplete = true;
                        }
                    }
                } // End of item loop

                if (document.getElementById('pot-total-value')) {
                    document.getElementById('pot-total-value').textContent = formatPot(pot);
                }

                // 完全不假使用者之手的自動推進行為
                if (!actionComplete && !hasWaitingAction && active.length > 0) {
                    createActionRow(street);
                    needsReCalc = true;
                }
            }

            // 【完全自動化】若邏輯完畢，且剩下的人 >= 2 (不是無競爭收下底池)，直接導航至下一街！
            const totalInvolved = active.length + globalAllIn.size;

            if (actionComplete) {
                if (active.length <= 1 && globalAllIn.size >= 1) {
                    skipFurtherActions = true;
                }
            }

            if (actionComplete && index < streets.length - 1 && totalInvolved >= 2) {
                const nextStreet = streets[index + 1];
                const nextSection = document.getElementById(`section-${nextStreet}`);
                if (nextSection && nextSection.classList.contains('hidden')) {
                    nextSection.classList.remove('hidden');

                    const nextActionList = document.getElementById(`action-list-${nextStreet}`);
                    if (nextActionList && nextActionList.children.length === 0 && !skipFurtherActions && active.length >= 2) {
                        createActionRow(nextStreet);
                    }

                    setTimeout(() => {
                        window.scrollTo({ top: nextSection.offsetTop - 150, behavior: 'smooth' });
                    }, 50);
                }
            }

            // IMPLICIT FOLD 最終結算
            if (actionItemsCount > 0) {
                preflopOrder.forEach(p => {
                    if (!globalFolded.has(p) && !globalAllIn.has(p)) {
                        const committed = playerCommitted[p] || 0;
                        if (committed < currentStreetBet && actionComplete) {
                            globalFolded.add(p);
                        }
                    }
                });
            }

            if (index < streets.length - 1) {
                const nextStreet = streets[index + 1];
                const nextStart = document.getElementById(`pot-start-${nextStreet}`);
                if (nextStart) nextStart.textContent = formatPot(pot);
            }
        });

        // -------------------------------------------------------------
        // Side Pot 精準切分邏輯
        // -------------------------------------------------------------
        let eligiblePlayers = [...active, ...Array.from(globalAllIn)]; // 未蓋牌的玩家
        let uniqueCaps = [...new Set(eligiblePlayers.map(p => playerTotalInvested[p] || 0))].sort((a, b) => a - b);
        let potsArr = [];
        let previousCap = 0;

        uniqueCaps.forEach((cap) => {
            if (cap === 0) return;
            let potSize = 0;
            let diff = cap - previousCap;
            for (let p in playerTotalInvested) {
                let inv = playerTotalInvested[p];
                if (inv >= cap) {
                    potSize += diff;
                } else if (inv > previousCap) {
                    potSize += (inv - previousCap);
                }
            }
            if (potSize > 0) potsArr.push(potSize);
            previousCap = cap;
        });

        let potDisplayString = formatPot(pot);
        if (potsArr.length > 1) {
            let breakdown = potsArr.map((p, i) => i === 0 ? `Main: ${formatPot(p)}` : `Side ${i}: ${formatPot(p)}`).join(' | ');
            potDisplayString = `${formatPot(pot)} <span style="font-size:0.85rem; font-weight:normal; color:#94a3b8; display:block; margin-top:0.3rem;">(${breakdown})</span>`;
        }

        if (document.getElementById('pot-total-value')) {
            document.getElementById('pot-total-value').innerHTML = potDisplayString;
        }

        const formEl = document.getElementById('hand-recorder-form');
        if (formEl) {
            formEl.dataset.potBreakdown = JSON.stringify(potsArr);
        }

        if (needsReCalc) {
            pendingCalculation = true;
        }
    }

    form.addEventListener('input', requestCalculatePot);
    form.addEventListener('change', requestCalculatePot);

    // Initial Trigger
    requestCalculatePot();

    // -------------------------------------------------------------
    // Card Selection Logic (Duplicate Prevention)
    // -------------------------------------------------------------
    const cardModal = document.getElementById('card-modal');
    const closeModalBtn = document.querySelector('.close-modal');
    const cardPickers = document.querySelectorAll('.card-picker');
    const suitBtns = document.querySelectorAll('.suit-btn');
    const rankBtns = document.querySelectorAll('.rank-btn');

    let currentTargetPicker = null;
    let selectedSuit = null;

    function getUsedCards() {
        const used = [];
        cardPickers.forEach(p => {
            if (p !== currentTargetPicker) {
                const val = p.querySelector('input').value;
                if (val) used.push(val);
            }
        });
        return used;
    }

    function updateRankButtons() {
        if (!selectedSuit) {
            rankBtns.forEach(b => b.disabled = true);
            return;
        }

        const usedCards = getUsedCards();
        rankBtns.forEach(btn => {
            const rank = btn.textContent;
            const cardString = `${rank}${selectedSuit}`;
            if (usedCards.includes(cardString)) {
                btn.disabled = true;
            } else {
                btn.disabled = false;
            }
        });
    }

    cardPickers.forEach(picker => {
        picker.addEventListener('click', () => {
            currentTargetPicker = picker;
            selectedSuit = null;
            updateSuitButtons();
            updateRankButtons();
            cardModal.classList.add('active');
        });
    });

    const closeModal = () => {
        cardModal.classList.remove('active');
        currentTargetPicker = null;
    };

    closeModalBtn.addEventListener('click', closeModal);
    cardModal.addEventListener('click', (e) => {
        if (e.target === cardModal) closeModal();
    });

    suitBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            selectedSuit = btn.getAttribute('data-suit');
            updateSuitButtons();
            updateRankButtons();
        });
    });

    function updateSuitButtons() {
        suitBtns.forEach(btn => {
            if (btn.getAttribute('data-suit') === selectedSuit) {
                btn.classList.add('selected');
            } else {
                btn.classList.remove('selected');
            }
        });
    }

    rankBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (!selectedSuit || !currentTargetPicker) return;

            const rank = btn.textContent;
            const hiddenInput = currentTargetPicker.querySelector('input');
            hiddenInput.value = `${rank}${selectedSuit}`;

            const display = currentTargetPicker.querySelector('.card-display');
            display.classList.remove('placeholder');
            display.classList.add('filled');

            let suitIcon = '';
            let suitClass = `suit-${selectedSuit}`;

            if (selectedSuit === 's') suitIcon = '♠';
            if (selectedSuit === 'h') suitIcon = '♥';
            if (selectedSuit === 'd') suitIcon = '♦';
            if (selectedSuit === 'c') suitIcon = '♣';

            display.innerHTML = `
                <div class="${suitClass}">${rank}</div>
                <div class="${suitClass} suit-icon">${suitIcon}</div>
            `;

            closeModal();
        });
    });

    cardPickers.forEach(picker => {
        picker.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const hiddenInput = picker.querySelector('input');
            const display = picker.querySelector('.card-display');

            const originalText =
                display.getAttribute('data-original') ||
                picker.getAttribute('data-card-target').replace('-', ' ');
            display.setAttribute('data-original', originalText);

            hiddenInput.value = '';
            display.className = 'card-display placeholder';
            display.textContent = originalText.charAt(0).toUpperCase() + originalText.slice(1);
        });
    });

    // -------------------------------------------------------------
    // Image Export Logic 📸
    // -------------------------------------------------------------
    const exportBtn = document.getElementById('btn-export-image');
    const imageModal = document.getElementById('image-result-modal');

    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            // 1. 抓取文字資訊
            const blinds = document.getElementById('blinds').value || '?/?';
            const pos = document.getElementById('position').value || '?';
            const players = document.getElementById('players').value || '?';
            const finalPotRaw = parseFloat(document.getElementById('pot-total-value').textContent) || 0;

            // 計算大盲金額基數 (為了 BB 顯示轉換)
            const blindMatches = blinds.match(/\d+(\.\d+)?/g);
            let bbValue = 1;
            if (blindMatches && blindMatches.length >= 1) {
                bbValue = Number(blindMatches[blindMatches.length - 1]);
            }
            if (bbValue === 0) bbValue = 1;

            const mode = document.getElementById('export-display-mode') ? document.getElementById('export-display-mode').value : 'chips';

            function formatExportAmount(rawAmount) {
                const amt = parseFloat(rawAmount) || 0;
                if (mode === 'bb') {
                    const bbAmt = amt / bbValue;
                    return (Number.isInteger(bbAmt) ? bbAmt : bbAmt.toFixed(2)) + ' BB';
                }
                return Number.isInteger(amt) ? amt : amt.toFixed(2);
            }

            document.getElementById('export-context').textContent = `Blinds: ${blinds}  |  Table: ${players}-Max`;
            // Hero position is now displayed on the table bubble itself

            let potDataset = document.getElementById('hand-recorder-form').dataset.potBreakdown;
            let exportPotStr = formatExportAmount(finalPotRaw);
            if (potDataset) {
                try {
                    let potsArr = JSON.parse(potDataset);
                    if (potsArr.length > 1) {
                        let bk = potsArr.map((p, i) => i === 0 ? `Main ${formatExportAmount(p)}` : `Side ${i} ${formatExportAmount(p)}`).join(' | ');
                        exportPotStr = `${formatExportAmount(finalPotRaw)}<br><span style="font-size:0.75rem; font-weight:normal; color:#cbd5e1; display:inline-block; margin-top:0.4rem;">(${bk})</span>`;
                    }
                } catch (e) { }
            }
            document.getElementById('export-final-pot').innerHTML = exportPotStr;

            // Generate seats array based on table size
            function getSeats(n) {
                if (n === 2) return ['SB', 'BB'];
                if (n === 3) return ['BTN', 'SB', 'BB'];
                if (n === 4) return ['CO', 'BTN', 'SB', 'BB'];
                if (n === 5) return ['HJ', 'CO', 'BTN', 'SB', 'BB'];
                if (n === 6) return ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
                if (n === 7) return ['UTG', 'UTG+1', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
                if (n === 8) return ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
                if (n === 9) return ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
                return ['SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN']; // default fallback
            }

            const nPlayers = parseInt(players) || 6;
            const tableSeats = getSeats(nPlayers);

            // Build player final states
            const pStates = {};
            ['preflop', 'flop', 'turn', 'river'].forEach(s => {
                const list = document.getElementById(`action-list-${s}`);
                if (!list) return;
                list.querySelectorAll('.action-item').forEach(item => {
                    if (item.style.display === 'none') return;
                    const sp = item.querySelector('select[name^="action_pos"]');
                    const sa = item.querySelector('select[name^="action_type"]');
                    if (sp && sa && sa.value !== '') {
                        pStates[sp.value] = sa.value;
                    }
                });
            });

            const seatsContainer = document.getElementById('table-seats-container');
            seatsContainer.innerHTML = '';

            // 繪製撲克桌 橢圓半徑
            const cx = 300, cy = 175;
            const rx = 260, ry = 135;

            tableSeats.forEach((seat, i) => {
                // 從 12 點鐘方向順時針擺放
                let angle = (3 * Math.PI / 2) + (i / nPlayers) * 2 * Math.PI;
                let x = cx + rx * Math.cos(angle);
                let y = cy + ry * Math.sin(angle);

                const isHero = (seat === pos);
                const lastAct = pStates[seat] || 'Fold'; // 若沒記錄代表潛在Fold（比如沒參與的座位）
                const isFolded = (!isHero) && (lastAct === 'Fold');

                const seatDiv = document.createElement('div');
                seatDiv.style.position = 'absolute';
                seatDiv.style.left = `${x}px`;
                seatDiv.style.top = `${y}px`;
                seatDiv.style.transform = 'translate(-50%, -50%)';
                seatDiv.style.display = 'flex';
                seatDiv.style.flexDirection = 'column';
                seatDiv.style.alignItems = 'center';
                seatDiv.style.zIndex = '10';

                // 座位氣泡 Bubble
                const badge = document.createElement('div');
                badge.style.padding = '0.35rem 1rem';
                badge.style.borderRadius = '20px';
                badge.style.fontWeight = '800';
                badge.style.fontSize = '0.95rem';
                badge.style.whiteSpace = 'nowrap';
                badge.style.boxShadow = '0 4px 10px rgba(0,0,0,0.6)';
                badge.style.position = 'relative';

                if (isHero) {
                    badge.style.background = 'var(--accent-green)';
                    badge.style.color = '#fff';
                    badge.style.boxShadow = '0 0 20px var(--accent-green)';
                    badge.style.border = '2px solid #fff';
                    badge.innerHTML = `★ Hero (${seat})`;
                } else if (isFolded) {
                    badge.style.background = '#334155';
                    badge.style.color = '#94a3b8';
                    badge.style.border = '2px solid #475569';
                    badge.innerHTML = `${seat} <span style="font-size:0.75rem; font-weight:normal; opacity:0.8;">(Fold)</span>`;
                    badge.style.opacity = '0.75';
                } else {
                    badge.style.background = '#1e293b';
                    badge.style.color = '#38bdf8';
                    badge.style.border = '2px solid #38bdf8';
                    badge.textContent = seat;
                }

                seatDiv.appendChild(badge);

                // Hero 專屬手牌渲染
                if (isHero) {
                    const hCardsDiv = document.createElement('div');
                    hCardsDiv.style.display = 'flex';
                    hCardsDiv.style.gap = '0.3rem';
                    hCardsDiv.style.marginTop = '0.5rem';

                    const cloneHeroCard = (selector) => {
                        const picker = document.querySelector(selector);
                        if (!picker) return;
                        const display = picker.querySelector('.card-display');
                        if (!display || display.classList.contains('placeholder')) return;
                        const clone = display.cloneNode(true);
                        clone.style.width = '38px';
                        clone.style.height = '54px';
                        clone.style.borderRadius = '6px';
                        clone.style.background = '#fff';
                        clone.style.display = 'flex';
                        clone.style.alignItems = 'center';
                        clone.style.justifyContent = 'center';
                        clone.style.border = '1px solid #cbd5e1';
                        clone.style.margin = '0';
                        clone.style.boxShadow = '0 4px 12px rgba(0,0,0,0.6)';
                        Array.from(clone.children).forEach(c => c.style.fontSize = '1.1rem');
                        hCardsDiv.appendChild(clone);
                    };
                    cloneHeroCard('div[data-card-target="hand-1"]');
                    cloneHeroCard('div[data-card-target="hand-2"]');

                    if (hCardsDiv.children.length > 0) {
                        seatDiv.appendChild(hCardsDiv);
                    }
                }

                seatsContainer.appendChild(seatDiv);
            });

            // 處理中心公牌 Board Cards
            const boardContainer = document.getElementById('export-board-cards');
            boardContainer.innerHTML = '';
            let boardCount = 0;
            const cloneBoardCard = (selector) => {
                const picker = document.querySelector(selector);
                if (!picker) return;
                const display = picker.querySelector('.card-display');
                if (!display || display.classList.contains('placeholder')) return;

                const clone = display.cloneNode(true);
                clone.style.width = '48px';
                clone.style.height = '68px';
                clone.style.borderRadius = '6px';
                clone.style.background = '#ffffff';
                clone.style.display = 'flex';
                clone.style.alignItems = 'center';
                clone.style.justifyContent = 'center';
                clone.style.fontSize = '1.3rem';
                clone.style.fontWeight = 'bold';
                clone.style.border = '1px solid #cbd5e1';
                clone.style.margin = '0';
                clone.style.boxShadow = '0 6px 12px rgba(0,0,0,0.6)';

                boardContainer.appendChild(clone);
                boardCount++;
            };

            ['flop-1', 'flop-2', 'flop-3', 'turn', 'river'].forEach(tid => {
                cloneBoardCard(`div[data-card-target="${tid}"]`);
            });

            if (boardCount === 0) {
                boardContainer.innerHTML = '<div style="color:rgba(255,255,255,0.4); font-style:italic; line-height: 70px;">( Preflop Ended )</div>';
            }

            // 3. 收拾精華文字戰報 LOG
            const logContainer = document.getElementById('export-action-log');
            let logText = [];
            const streets = ['preflop', 'flop', 'turn', 'river'];
            const streetNames = ['Preflop', 'Flop', 'Turn', 'River'];

            streets.forEach((street, idx) => {
                const actionList = document.getElementById(`action-list-${street}`);
                if (!actionList) return;

                const items = actionList.querySelectorAll('.action-item');
                let streetActions = [];
                items.forEach(item => {
                    if (item.style.display === 'none') return;

                    const posEl = item.querySelector('select[name^="action_pos"]');
                    const actEl = item.querySelector('select[name^="action_type"]');
                    const amtEl = item.querySelector('input[name^="action_amount"]');

                    if (!actEl || actEl.value === '') return;

                    const p = posEl.value;
                    const a = actEl.value;

                    // 使用數學引擎推算出存在 DOM 的隱藏真實下注額（特別針對被隱藏輸入框的自動計算 Call）
                    const computedAmt = item.getAttribute('data-computed-amt');
                    const v = computedAmt !== null ? computedAmt : amtEl.value;
                    const displayV = formatExportAmount(v);

                    if (a === 'Fold' || a === 'Check') {
                        streetActions.push(`<span style="color:#38bdf8; font-weight:600;">${p}</span> ${a}`);
                    } else if (a === 'All-in') {
                        streetActions.push(`<span style="color:#38bdf8; font-weight:600;">${p}</span> Shoves <span style="color:#10b981;">${displayV}</span>`);
                    } else {
                        streetActions.push(`<span style="color:#38bdf8; font-weight:600;">${p}</span> ${a} <span style="color:#10b981;">${displayV}</span>`);
                    }
                });

                if (streetActions.length > 0) {
                    logText.push(`<div style="margin-bottom:0.8rem;"><strong style="color:#cbd5e1;">[${streetNames[idx]}]</strong><br>  ${streetActions.join(' ➔ ')}</div>`);
                }
            });

            logContainer.innerHTML = logText.length > 0 ? logText.join('') : '<span style="color:#64748b;">No actions recorded.</span>';

            // 4. Html2Canvas 渲染
            const exportTarget = document.getElementById('export-card-container');
            exportBtn.textContent = 'Generating Image... ⏳';
            exportBtn.disabled = true;

            try {
                // 等待字體和樣式就緒
                await new Promise(r => setTimeout(r, 100));

                const canvas = await html2canvas(exportTarget, {
                    scale: 2,
                    backgroundColor: '#0f172a',
                    logging: false,
                    useCORS: true
                });

                const imgData = canvas.toDataURL('image/png');
                const imgResultContainer = document.getElementById('image-result-container');
                imgResultContainer.innerHTML = `<img src="${imgData}" style="width: 100%; display: block;" alt="Hand History Image"/>`;

                const btnDownload = document.getElementById('btn-download-image');
                if (btnDownload) {
                    btnDownload.onclick = () => {
                        const link = document.createElement('a');
                        link.download = `PokerTracker_${Date.now()}.png`;
                        link.href = imgData;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                    };
                }

                imageModal.classList.add('active');
            } catch (err) {
                console.error(err);
                alert('匯出圖片發生錯誤。這可能是環境安全性限制引起。');
            } finally {
                exportBtn.textContent = 'Export as Image (一鍵匯出戰報) 📸';
                exportBtn.disabled = false;
            }
        });
    }

    const closeImageModalBtns = document.querySelectorAll('.close-image-modal');
    if (closeImageModalBtns.length > 0) {
        closeImageModalBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                imageModal.classList.remove('active');
                // Remove image to free memory
                const imgResultContainer = document.getElementById('image-result-container');
                if (imgResultContainer) imgResultContainer.innerHTML = '';
            });
        });
    }
});
