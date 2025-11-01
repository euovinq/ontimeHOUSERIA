// Interceptação de baixo nível usando CoreAudio
// Este arquivo contém funções auxiliares para interceptar áudio em baixo nível

#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/CoreAudioTypes.h>
#import <AudioToolbox/AudioToolbox.h>
#import <AVFoundation/AVFoundation.h>

// Estrutura para armazenar informações de áudio interceptado
typedef struct {
    BOOL isActive;
    double sampleRate;
    UInt32 channels;
    UInt32 bytesPerSample;
    AudioStreamBasicDescription format;
    Float32 peakLevel; // Nível de pico do áudio (0.0 a 1.0)
    UInt64 totalFrames;
    NSTimeInterval startTime;
    NSTimeInterval lastUpdateTime;
} LowLevelAudioInfo;

static LowLevelAudioInfo g_lowLevelAudioInfo = {0};

// Callback para capturar áudio em baixo nível
OSStatus AudioInputCallback(void *inRefCon,
                           AudioUnitRenderActionFlags *ioActionFlags,
                           const AudioTimeStamp *inTimeStamp,
                           UInt32 inBusNumber,
                           UInt32 inNumberFrames,
                           AudioBufferList *ioData) {
    
    LowLevelAudioInfo *audioInfo = (LowLevelAudioInfo *)inRefCon;
    
    if (!audioInfo || !ioData) {
        return noErr;
    }
    
    // Atualiza informações
    audioInfo->lastUpdateTime = [[NSDate date] timeIntervalSince1970];
    audioInfo->totalFrames += inNumberFrames;
    
    // Calcula nível de pico
    Float32 peak = 0.0;
    for (UInt32 i = 0; i < ioData->mNumberBuffers; i++) {
        AudioBuffer *buffer = &ioData->mBuffers[i];
        if (buffer->mData) {
            Float32 *samples = (Float32 *)buffer->mData;
            for (UInt32 j = 0; j < inNumberFrames; j++) {
                Float32 absValue = fabsf(samples[j]);
                if (absValue > peak) {
                    peak = absValue;
                }
            }
        }
    }
    audioInfo->peakLevel = peak;
    
    return noErr;
}

// Função para inicializar captura de áudio em baixo nível
BOOL initLowLevelAudioCapture(void) {
    if (g_lowLevelAudioInfo.isActive) {
        return YES; // Já está ativo
    }
    
    // Configura formato de áudio
    AudioStreamBasicDescription audioFormat;
    audioFormat.mSampleRate = 44100.0;
    audioFormat.mFormatID = kAudioFormatLinearPCM;
    audioFormat.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked | kAudioFormatFlagIsNonInterleaved;
    audioFormat.mBytesPerPacket = sizeof(Float32);
    audioFormat.mFramesPerPacket = 1;
    audioFormat.mBytesPerFrame = sizeof(Float32);
    audioFormat.mChannelsPerFrame = 2; // Estéreo
    audioFormat.mBitsPerChannel = 32;
    
    // Cria AudioComponent para capturar do sistema
    AudioComponentDescription componentDescription;
    componentDescription.componentType = kAudioUnitType_Output;
    componentDescription.componentSubType = kAudioUnitSubType_HALOutput;
    componentDescription.componentManufacturer = kAudioUnitManufacturer_Apple;
    componentDescription.componentFlags = 0;
    componentDescription.componentFlagsMask = 0;
    
    AudioComponent component = AudioComponentFindNext(NULL, &componentDescription);
    if (!component) {
        NSLog(@"❌ Não foi possível encontrar componente de áudio");
        return NO;
    }
    
    AudioUnit audioUnit;
    OSStatus status = AudioComponentInstanceNew(component, &audioUnit);
    if (status != noErr) {
        NSLog(@"❌ Erro ao criar instância de áudio: %d", (int)status);
        return NO;
    }
    
    // Tenta habilitar input
    UInt32 enableInput = 1;
    status = AudioUnitSetProperty(audioUnit,
                                   kAudioOutputUnitProperty_EnableIO,
                                   kAudioUnitScope_Input,
                                   1, // input element
                                   &enableInput,
                                   sizeof(enableInput));
    
    if (status != noErr) {
        NSLog(@"⚠️ Não foi possível habilitar input de áudio (pode ser limitação do sistema): %d", (int)status);
        AudioComponentInstanceDispose(audioUnit);
        return NO;
    }
    
    // Configura formato
    status = AudioUnitSetProperty(audioUnit,
                                   kAudioUnitProperty_StreamFormat,
                                   kAudioUnitScope_Input,
                                   0,
                                   &audioFormat,
                                   sizeof(audioFormat));
    
    if (status != noErr) {
        NSLog(@"❌ Erro ao configurar formato: %d", (int)status);
        AudioComponentInstanceDispose(audioUnit);
        return NO;
    }
    
    // Configura callback
    AURenderCallbackStruct callbackStruct;
    callbackStruct.inputProc = AudioInputCallback;
    callbackStruct.inputProcRefCon = &g_lowLevelAudioInfo;
    
    status = AudioUnitSetProperty(audioUnit,
                                   kAudioOutputUnitProperty_SetInputCallback,
                                   kAudioUnitScope_Global,
                                   0,
                                   &callbackStruct,
                                   sizeof(callbackStruct));
    
    if (status != noErr) {
        NSLog(@"❌ Erro ao configurar callback: %d", (int)status);
        AudioComponentInstanceDispose(audioUnit);
        return NO;
    }
    
    // Inicializa
    status = AudioUnitInitialize(audioUnit);
    if (status != noErr) {
        NSLog(@"❌ Erro ao inicializar audio unit: %d", (int)status);
        AudioComponentInstanceDispose(audioUnit);
        return NO;
    }
    
    // Inicia captura
    status = AudioOutputUnitStart(audioUnit);
    if (status != noErr) {
        NSLog(@"❌ Erro ao iniciar captura: %d", (int)status);
        AudioUnitUninitialize(audioUnit);
        AudioComponentInstanceDispose(audioUnit);
        return NO;
    }
    
    // Configura informações globais
    g_lowLevelAudioInfo.isActive = YES;
    g_lowLevelAudioInfo.sampleRate = audioFormat.mSampleRate;
    g_lowLevelAudioInfo.channels = audioFormat.mChannelsPerFrame;
    g_lowLevelAudioInfo.bytesPerSample = sizeof(Float32);
    g_lowLevelAudioInfo.format = audioFormat;
    g_lowLevelAudioInfo.startTime = [[NSDate date] timeIntervalSince1970];
    g_lowLevelAudioInfo.lastUpdateTime = g_lowLevelAudioInfo.startTime;
    g_lowLevelAudioInfo.totalFrames = 0;
    g_lowLevelAudioInfo.peakLevel = 0.0;
    
    NSLog(@"✅ Captura de áudio em baixo nível iniciada!");
    NSLog(@"   Sample Rate: %.0f Hz", g_lowLevelAudioInfo.sampleRate);
    NSLog(@"   Canais: %u", (unsigned int)g_lowLevelAudioInfo.channels);
    
    return YES;
}

// Função para obter informações de áudio capturado
LowLevelAudioInfo getLowLevelAudioInfo(void) {
    return g_lowLevelAudioInfo;
}

// Função para verificar se há áudio sendo reproduzido
BOOL isLowLevelAudioPlaying(void) {
    if (!g_lowLevelAudioInfo.isActive) {
        // Tenta inicializar se não estiver ativo
        initLowLevelAudioCapture();
        return NO;
    }
    
    NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
    NSTimeInterval timeSinceUpdate = now - g_lowLevelAudioInfo.lastUpdateTime;
    
    // Se atualizou nos últimos 0.5 segundos e há sinal de áudio
    if (timeSinceUpdate < 0.5 && g_lowLevelAudioInfo.peakLevel > 0.01) {
        return YES;
    }
    
    return NO;
}

// Função para obter duração de áudio capturado (em segundos)
double getLowLevelAudioDuration(void) {
    if (!g_lowLevelAudioInfo.isActive || g_lowLevelAudioInfo.sampleRate == 0) {
        return 0.0;
    }
    
    return (double)g_lowLevelAudioInfo.totalFrames / g_lowLevelAudioInfo.sampleRate;
}





