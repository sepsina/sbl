
export enum eRxState {
    E_STATE_RX_WAIT_START,
    E_STATE_RX_WAIT_TYPELSB,
    E_STATE_RX_WAIT_TYPEMSB,
    E_STATE_RX_WAIT_LENLSB,
    E_STATE_RX_WAIT_LENMSB,
    E_STATE_RX_WAIT_CRC,
    E_STATE_RX_WAIT_DATA,
}

export interface rdKeys_t {
    status: number;
    nwkKey: string;
    panId: number;
    nwkCh: number;
}

export interface slMsg_t {
    type: number;
    data: number[];
}

export interface msgLogs_t {
    text: string;
    color: string;
    id: number;
}

export class rwBuf_t {

    rdIdx: number;
    wrIdx: number;

    rdBuf: any;
    wrBuf: any;

    constructor(){

    }

    read_uint8(){
        const val = this.rdBuf.readUInt8(this.rdIdx);
        this.rdIdx += 1;
        return val;
    }

    read_uint16_LE(){
        const val = this.rdBuf.readUInt16LE(this.rdIdx);
        this.rdIdx += 2;
        return val;
    }

    read_uint32_LE(){
        const val = this.rdBuf.readUInt32LE(this.rdIdx);
        this.rdIdx += 4;
        return val;
    }

    read_double_LE(){
        const val = this.rdBuf.readDoubleLE(this.rdIdx);
        this.rdIdx += 8;
        return val;
    }

    write_uint8(val: number){
        this.wrBuf.writeUInt8(val, this.wrIdx);
        this.wrIdx += 1;
    }

    modify_uint8(val: number, idx: number){
        this.wrBuf.writeUInt8(val, idx);
    }

    write_uint16_LE(val: number){
        this.wrBuf.writeUInt16LE(val, this.wrIdx);
        this.wrIdx += 2;
    }

    write_int16_LE(val: number){
        this.wrBuf.writeInt16LE(val, this.wrIdx);
        this.wrIdx += 2;
    }

    modify_uint16_LE(val: number, idx: number){
        this.wrBuf.writeUInt16LE(val, idx);

    }

    write_uint32_LE(val: number){
        this.wrBuf.writeUInt32LE(val, this.wrIdx);
        this.wrIdx += 4;
    }

    write_double_LE(val: number){
        this.wrBuf.writeDoubleLE(val, this.wrIdx);
        this.wrIdx += 8;
    }
}

