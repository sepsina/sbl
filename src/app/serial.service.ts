///<reference types="chrome"/>
//'use strict';
import { Injectable, NgZone } from '@angular/core';
import { EventsService } from './events.service';
import { GlobalsService } from './globals.service';
import { UtilsService } from './utils.service';
import * as gIF from './gIF';
import * as gConst from './gConst';

interface sl_msg {
    type: number;
    nodeBuf: any;
}

const ORANGE = 'orangered';
const RED = 'red';
const GREEN = 'green';
const BLUE = 'blue';
const OLIVE = 'olive';
const PURPLE = 'purple'
const CHOCOLATE = 'chocolate';

const FLASH_PAGE_SIZE = 512;

const key = [
    0x00,0x01,0x02,0x03,
    0x04,0x05,0x06,0x07,
    0x08,0x09,0x0A,0x0B,
    0x0C,0x0D,0x0E,0x0F
];

@Injectable({
    providedIn: 'root',
})
export class SerialService {

    public searchPortFlag = false;
    validPortFlag = false;
    portOpenFlag = false;
    private portIdx = 0;
    portPath = '';

    private testPortTMO = null;

    private crc = 0;
    private calcCRC = 0;
    private msgIdx = 0;
    private isEsc = false;
    private rxBuf = new ArrayBuffer(256);
    private rxMsg = new Uint8Array(this.rxBuf);
    private rxState = gIF.eRxState.E_STATE_RX_WAIT_START;

    private msgType = 0;
    private msgLen = 0;

    private seqNum = 0;

    private comFlag = false;
    private comPorts = [];
    private connID = -1;

    //validPortTMO = null;

    //trash: any;

    rxNodeBuf = window.nw.Buffer.alloc(1024);
    txNodeBuf = window.nw.Buffer.alloc(1024);
    rwBuf = new gIF.rwBuf_t();
    //msgNodeBuff: any;

    slMsg = {} as sl_msg;

    binData: any;
    binFlag = false;
    binPage = 0;
    binPagesNum = 0;
    wrBinFlag = false;
    binProgress = 0;

    flashPagesNum = 0;
    lastPage = window.nw.Buffer.alloc(FLASH_PAGE_SIZE);

    fs: any;
    aes_js: any;

    constructor(private events: EventsService,
                private globals: GlobalsService,
                private utils: UtilsService,
                private ngZone: NgZone) {
        chrome.serial.onReceive.addListener((info)=>{
            if(info.connectionId === this.connID){
                this.slOnData(info.data);
            }
        });
        chrome.serial.onReceiveError.addListener((info: any)=>{
                this.rcvErrCB(info);
        });

        this.fs = window.nw.require('fs');
        this.aes_js = window.nw.require('aes-js');
        /*
        setTimeout(()=>{
            this.checkCom();
        }, 15000);
        */
        this.rwBuf.wrBuf = this.txNodeBuf;

        setTimeout(()=>{
            this.listComPorts();
        }, 1000);
    }

    /***********************************************************************************************
     * fn          checkCom
     *
     * brief
     *
     */
    async checkCom() {
        if(this.comFlag == false) {
            await this.closeComPort();
        }
        this.comFlag = false;
        setTimeout(()=>{
            this.checkCom();
        }, 30000);
    }

    /***********************************************************************************************
     * fn          closeComPort
     *
     * brief
     *
     */
    async closeComPort() {
        if(this.connID > -1){
            this.utils.sendMsg('close port', 'red');
            this.events.publish('closePort', 'close');

            const result = await this.closePortAsync(this.connID);
            if(result){
                this.connID = -1;
                this.portOpenFlag = false;
                this.validPortFlag = false;
                setTimeout(() => {
                    this.findComPort();
                }, 200);
            }
        }
    }

    /***********************************************************************************************
     * fn          closePortAsync
     *
     * brief
     *
     */
    closePortAsync(id: number) {
        return new Promise((resolve)=>{
            chrome.serial.disconnect(id, (result)=>{
                resolve(result);
            });
        });
    }

    /***********************************************************************************************
     * fn          listComPorts
     *
     * brief
     *
     */
    listComPorts() {
        chrome.serial.getDevices((ports)=>{
            /*
            for(let i = 0; i < ports.length; i++){
                if(ports[i].vendorId){
                    if(ports[i].productId){
                        this.comPorts.push(ports[i]);
                    }
                }
            }
            */
            this.comPorts = ports;
            if(this.comPorts.length) {
                this.searchPortFlag = true;
                this.portIdx = 0;
                setTimeout(()=>{
                    this.findComPort();
                }, 200);
            }
            else {
                this.searchPortFlag = false;
                setTimeout(()=>{
                    this.listComPorts();
                }, 2000);
                this.utils.sendMsg('no com ports', 'red', 7);
            }
        });
    }

    /***********************************************************************************************
     * fn          findComPort
     *
     * brief
     *
     */
    async findComPort() {

        if(this.searchPortFlag === false){
            setTimeout(()=>{
                this.listComPorts();
            }, 1000);
            return;
        }
        this.portPath = this.comPorts[this.portIdx].path;
        this.utils.sendMsg(`testing: ${this.portPath}`, 'blue');
        let connOpts = {
            bitrate: 115200
        };
        const connInfo: any = await this.serialConnectAsync(connOpts);
        if(connInfo){
            this.connID = connInfo.connectionId;
            this.portOpenFlag = true;
            this.testPortTMO = setTimeout(()=>{
                this.closeComPort();
            }, 1500);
            setTimeout(() => {
                this.testPortReq();
            }, 10);
        }
        else {
            this.utils.sendMsg(`err: ${chrome.runtime.lastError.message}`, 'red');
            setTimeout(() => {
                this.findComPort();
            }, 10);
        }
        this.portIdx++;
        if(this.portIdx >= this.comPorts.length) {
            this.searchPortFlag = false;
        }
    }

    /***********************************************************************************************
     * fn          serialConnectAsync
     *
     * brief
     *
     */
    serialConnectAsync(connOpt) {
        return new Promise((resolve)=>{
            chrome.serial.connect(this.portPath, connOpt, (connInfo)=>{
                resolve(connInfo);
            });
        });
    }

    /***********************************************************************************************
     * fn          slOnData
     *
     * brief
     *
     */
    private slOnData(msg) {

        let pkt = new Uint8Array(msg);

        for(let i = 0; i < pkt.length; i++) {
            let rxByte = pkt[i];
            switch(rxByte) {
                case gConst.SL_START_CHAR: {
                    this.msgIdx = 0;
                    this.isEsc = false;
                    this.rxState = gIF.eRxState.E_STATE_RX_WAIT_TYPELSB;
                    break;
                }
                case gConst.SL_ESC_CHAR: {
                    this.isEsc = true;
                    break;
                }
                case gConst.SL_END_CHAR: {
                    if(this.crc == this.calcCRC) {
                        this.slMsg.type = this.msgType;
                        this.slMsg.nodeBuf = this.rxNodeBuf.subarray(0, this.msgLen);
                        this.processMsg(this.slMsg);
                    }
                    this.rxState = gIF.eRxState.E_STATE_RX_WAIT_START;
                    break;
                }
                default: {
                    if(this.isEsc == true) {
                        rxByte ^= 0x10;
                        this.isEsc = false;
                    }
                    switch(this.rxState) {
                        case gIF.eRxState.E_STATE_RX_WAIT_START: {
                            // ---
                            break;
                        }
                        case gIF.eRxState.E_STATE_RX_WAIT_TYPELSB: {
                            this.msgType = rxByte;
                            this.rxState = gIF.eRxState.E_STATE_RX_WAIT_TYPEMSB;
                            this.calcCRC = rxByte;
                            break;
                        }
                        case gIF.eRxState.E_STATE_RX_WAIT_TYPEMSB: {
                            this.msgType += rxByte << 8;
                            this.rxState = gIF.eRxState.E_STATE_RX_WAIT_LENLSB;
                            this.calcCRC ^= rxByte;
                            break;
                        }
                        case gIF.eRxState.E_STATE_RX_WAIT_LENLSB: {
                            this.msgLen = rxByte;
                            this.rxState = gIF.eRxState.E_STATE_RX_WAIT_LENMSB;
                            this.calcCRC ^= rxByte;
                            break;
                        }
                        case gIF.eRxState.E_STATE_RX_WAIT_LENMSB: {
                            this.msgLen += rxByte << 8;
                            this.rxState = gIF.eRxState.E_STATE_RX_WAIT_CRC;
                            this.calcCRC ^= rxByte;
                            break;
                        }
                        case gIF.eRxState.E_STATE_RX_WAIT_CRC: {
                            this.crc = rxByte;
                            this.rxState = gIF.eRxState.E_STATE_RX_WAIT_DATA;
                            break;
                        }
                        case gIF.eRxState.E_STATE_RX_WAIT_DATA: {
                            if(this.msgIdx < this.msgLen) {
                                this.rxNodeBuf[this.msgIdx++] = rxByte;
                                this.calcCRC ^= rxByte;
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    /***********************************************************************************************
     * fn          processMsg
     *
     * brief
     *
     */
    private processMsg(slMsg: sl_msg) {

        console.log(slMsg);

        this.rwBuf.rdBuf = slMsg.nodeBuf;
        this.rwBuf.rdIdx = 0;

        switch(slMsg.type) {
            case gConst.SL_MSG_TESTPORT: {
                let idNum = 0;
                let msgSeqNum = this.rwBuf.read_uint8();
                if(msgSeqNum == this.seqNum) {
                    idNum = this.rwBuf.read_uint32_LE();
                    if(idNum === 0x67190110) {
                        clearTimeout(this.testPortTMO);
                        this.validPortFlag = true;
                        this.searchPortFlag = false;
                        this.utils.sendMsg('port valid', 'green');
                    }
                }
                break;
            }
            case gConst.SL_MSG_USB_CMD: {
                let msgSeqNum = this.rwBuf.read_uint8();
                if(msgSeqNum == this.seqNum) {
                    let cmdID = this.rwBuf.read_uint8();
                    switch(cmdID) {
                        case gConst.USB_CMD_WR_PAGE: {
                            let status = this.rwBuf.read_uint8();
                            switch(status){
                                case gConst.FLASH_STATUS_OK: {
                                    this.binPage++;
                                    if(this.binPage < this.flashPagesNum){
                                        setTimeout(()=>{
                                            this.wrFlashPageReq();
                                        }, 10);
                                    }
                                    else {
                                        setTimeout(()=>{
                                            this.writeBinDone();
                                        }, 10);
                                    }
                                    break;
                                }
                                case gConst.FLASH_STATUS_INIT_FAIL: {
                                    this.utils.sendMsg("flash err: init fail", 'red');
                                    break;
                                }
                                case gConst.FLASH_STATUS_ERASE_FAIL: {
                                    this.utils.sendMsg("flash err: erase fail", 'red');
                                    break;
                                }
                                case gConst.FLASH_STATUS_PROG_FAIL: {
                                    this.utils.sendMsg("flash err: prog fail", 'red');
                                    break;
                                }
                                case gConst.FLASH_STATUS_VERIFY_FAIL: {
                                    this.utils.sendMsg("flash err: verify fail", 'red');
                                    break;
                                }
                                default: {
                                    this.utils.sendMsg("flash err: unsuported", 'red');
                                    break;
                                }
                            }
                            break;
                        }
                        default: {
                            // ---
                        }
                    }
                }
                break;
            }
            case gConst.SL_MSG_LOG: {
                let log_msg = '';
                let chrCode: number
                for(let i = 0; i < slMsg.nodeBuf.length; i++) {
                    chrCode = this.rwBuf.read_uint8();
                    if(chrCode != 0) {
                        log_msg += String.fromCharCode(chrCode);
                    }
                }
                this.utils.sendMsg(log_msg, 'orange');
                break;
            }
        }
    }

    /***********************************************************************************************
     * fn          testPortReq
     *
     * brief
     *
     */
    async testPortReq() {

        this.seqNum = ++this.seqNum % 256;
        this.rwBuf.wrIdx = 0;

        this.rwBuf.write_uint16_LE(gConst.SL_MSG_TESTPORT);
        this.rwBuf.write_uint16_LE(0); // len
        this.rwBuf.write_uint8(0);     // CRC
        // cmd data
        this.rwBuf.write_uint8(this.seqNum);
        this.rwBuf.write_uint32_LE(0x67190110);

        let msgLen = this.rwBuf.wrIdx;
        let dataLen = msgLen - gConst.HEAD_LEN;
        this.rwBuf.modify_uint16_LE(dataLen, gConst.LEN_IDX);
        let crc = 0;
        for(let i = 0; i < msgLen; i++) {
            crc ^= this.txNodeBuf[i];
        }
        this.rwBuf.modify_uint8(crc, gConst.CRC_IDX);

        await this.serialSend(msgLen);
    }

    /***********************************************************************************************
     * fn          serialSend
     *
     * brief
     *
     */
    async serialSend(msgLen: number) {

        let slMsgBuf = new Uint8Array(1024);
        let msgIdx = 0;

        slMsgBuf[msgIdx++] = gConst.SL_START_CHAR;
        for(let i = 0; i < msgLen; i++) {
            if(this.txNodeBuf[i] < 0x10) {
                this.txNodeBuf[i] ^= 0x10;
                slMsgBuf[msgIdx++] = gConst.SL_ESC_CHAR;
            }
            slMsgBuf[msgIdx++] = this.txNodeBuf[i];
        }
        slMsgBuf[msgIdx++] = gConst.SL_END_CHAR;

        let slMsgLen = msgIdx;
        let slMsg = slMsgBuf.slice(0, slMsgLen);

        const sendInfo: any = await this.serialSendAsync(slMsg);
        if(sendInfo.error){
            this.utils.sendMsg(`send err: ${sendInfo.error}`, 'red');
        }
    }

    /***********************************************************************************************
     * fn          serialSendAsync
     *
     * brief
     *
     */
    serialSendAsync(slMsg: any) {
        return new Promise((resolve)=>{
            chrome.serial.send(this.connID, slMsg.buffer, (sendInfo: any)=>{
                resolve(sendInfo);
            });
        });
    }

    /***********************************************************************************************
     * fn          rcvErrCB
     *
     * brief
     *
     */
    async rcvErrCB(info: any) {
        if(info.connectionId === this.connID){
            switch(info.error){
                case 'disconnected': {
                    this.utils.sendMsg(`${this.portPath} disconnected`);
                    setTimeout(()=>{
                        this.closeComPort();
                    }, 10);
                    break;
                }
                case 'device_lost': {
                    this.utils.sendMsg(`${this.portPath} lost`, 'red');
                    setTimeout(()=>{
                        this.closeComPort();
                    }, 10);
                    break;
                }
                case 'system_error': {
                    break;
                }
                case 'timeout':
                case 'break':
                case 'frame_error':
                case 'overrun':
                case 'buffer_overflow':
                case 'parity_error': {
                    // ---
                    break;
                }
            }
        }
    }

    /***********************************************************************************************
     * fn          readBin
     *
     * brief
     *
     */
    readBin(path: string) {

        if(this.wrBinFlag == true){
            this.utils.sendMsg(`busy`, CHOCOLATE);
            return;
        }
        this.binData = this.fs.readFileSync(path);
        if(this.binData){
            this.binFlag = true;
            this.binPage = 0;
            let len = this.binData.length;
            this.binPagesNum = Math.floor(len / FLASH_PAGE_SIZE);
            this.flashPagesNum = this.binPagesNum;
            let rem = len % FLASH_PAGE_SIZE;
            if(rem > 0){
                this.flashPagesNum++;
                let i = 0;
                let idx = FLASH_PAGE_SIZE * this.binPagesNum;
                for(i = 0; i < rem; i++){
                    this.lastPage[i] = this.binData[idx++];
                }
                for(; i < FLASH_PAGE_SIZE; i++){
                    this.lastPage[i] = 0xFF;
                }
            }
        }
    }

    /***********************************************************************************************
     * fn   getBinWrStatus
     *
     * brief
     *
     */
    getBinWrStatus(){

        let disabled = false;

        if(this.portOpenFlag == false){
            disabled = true;
        }
        if(this.binData){
            if(this.binData.length == 0){
                disabled = true;
            }
        }
        else {
            disabled = true;
        }
        if(this.wrBinFlag == true){
            disabled = true;
        }

        return disabled;
    }

    /***********************************************************************************************
     * fn          wrFlashPageReq
     *
     * brief
     *
     */
    async wrFlashPageReq() {

        this.seqNum = ++this.seqNum % 256;
        this.rwBuf.wrIdx = 0;

        this.rwBuf.write_uint16_LE(gConst.SL_MSG_USB_CMD);
        this.rwBuf.write_uint16_LE(0); // len
        this.rwBuf.write_uint8(0);     // CRC
        // cmd data
        this.rwBuf.write_uint8(this.seqNum);
        this.rwBuf.write_uint8(gConst.USB_CMD_WR_PAGE);
        this.rwBuf.write_uint32_LE(this.binPage);


        let page_data = [];
        if(this.binPage < this.binPagesNum){
            let binIdx = this.binPage * FLASH_PAGE_SIZE;
            for(let i = 0; i < FLASH_PAGE_SIZE; i++){
                page_data.push(this.binData[binIdx++]);
            }
        }
        else {
            for(let i = 0; i < FLASH_PAGE_SIZE; i++){
                page_data.push(this.lastPage[i]);
            }
        }
        let aesEcb = new this.aes_js.ModeOfOperation.ecb(key);
        var encryptedBytes = aesEcb.encrypt(page_data);
        for(let i = 0; i < FLASH_PAGE_SIZE; i++){
            this.rwBuf.write_uint8(encryptedBytes[i]);
        }

        /*
        if(this.binPage < this.binPagesNum){
            let binIdx = this.binPage * FLASH_PAGE_SIZE;
            for(let i = 0; i < FLASH_PAGE_SIZE; i++){
                this.rwBuf.write_uint8(this.binData[binIdx++]);
            }
        }
        else {
            for(let i = 0; i < FLASH_PAGE_SIZE; i++){
                this.rwBuf.write_uint8(this.lastPage[i]);
            }
        }
        */
        this.ngZone.run(()=>{
            this.binProgress = 100 * this.binPage / this.binPagesNum;
        });
        this.utils.sendMsg(`--- ${this.binProgress.toFixed(1)}% ---`, GREEN, 7);

        let msgLen = this.rwBuf.wrIdx;
        let dataLen = msgLen - gConst.HEAD_LEN;
        this.rwBuf.modify_uint16_LE(dataLen, gConst.LEN_IDX);
        let crc = 0;
        for(let i = 0; i < msgLen; i++) {
            crc ^= this.txNodeBuf[i];
        }
        this.rwBuf.modify_uint8(crc, gConst.CRC_IDX);

        await this.serialSend(msgLen);
    }

    /***********************************************************************************************
     * fn          writeBin
     *
     * brief
     *
     */
    writeBin() {

        if(this.binFlag == false){
            this.utils.sendMsg(`select bin file`, CHOCOLATE);
            return;
        }
        if(this.wrBinFlag == true){
            this.utils.sendMsg(`busy`, CHOCOLATE);
            return;
        }
        if(this.portOpenFlag == false){
            this.utils.sendMsg(`no port open`, CHOCOLATE);
            return;
        }

        this.ngZone.run(()=>{
            this.wrBinFlag = true;
            this.binProgress = 0;
        });
        setTimeout(() => {
            this.binPage = 0;
            this.wrFlashPageReq();
        }, 10);
    }

    /***********************************************************************************************
     * fn          writeBinDone
     *
     * brief
     *
     */
    writeBinDone() {

        this.binPage = 0;

        this.ngZone.run(()=>{
            this.wrBinFlag = false;
            this.binProgress = 0;
        });
    }
}
