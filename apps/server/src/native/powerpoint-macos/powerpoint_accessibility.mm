#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <ScriptingBridge/ScriptingBridge.h>
#import <OSAKit/OSAKit.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreAudio/CoreAudio.h>
#import <AudioToolbox/AudioToolbox.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreVideo/CoreVideo.h>
#import <CoreAudio/CoreAudioTypes.h>
#import <AVFoundation/AVAudioEngine.h>
#import <AVFoundation/AVAudioFormat.h>
#import <AVFoundation/AVAudioPlayerNode.h>
#include <napi.h>

// Função auxiliar para converter CFString para NSString
NSString* CFStringToNSString(CFStringRef cfString) {
    if (!cfString) return nil;
    return (__bridge NSString*)cfString;
}

// Forward declaration
@class AudioVideoCaptureState;

// Classe para implementar SCStreamOutput protocol
@interface PowerPointStreamOutput : NSObject <SCStreamOutput>
@property (nonatomic, assign) BOOL isAudioOutput;
@property (nonatomic, unsafe_unretained) AudioVideoCaptureState *captureState;
@end

// Estrutura para armazenar estado de captura de áudio/vídeo
@interface AudioVideoCaptureState : NSObject
@property (nonatomic, assign) BOOL isMonitoring;
@property (nonatomic, strong) SCStream *stream;
@property (nonatomic, strong) PowerPointStreamOutput *audioOutput;
@property (nonatomic, strong) PowerPointStreamOutput *videoOutput;
@property (nonatomic, assign) BOOL hasAudioActivity;
@property (nonatomic, assign) BOOL hasVideoActivity;
@property (nonatomic, assign) NSTimeInterval lastActivityTime;
@property (nonatomic, assign) NSTimeInterval firstAudioTime; // Tempo da primeira captura de áudio
@property (nonatomic, assign) NSTimeInterval firstVideoTime; // Tempo da primeira captura de vídeo
@property (nonatomic, assign) double audioDuration; // Duração total de áudio capturado (segundos)
@property (nonatomic, assign) double videoDuration; // Duração total de vídeo capturado (segundos)
@property (nonatomic, assign) UInt64 audioFrameCount; // Total de frames de áudio capturados
@property (nonatomic, assign) UInt64 videoFrameCount; // Total de frames de vídeo capturados
@property (nonatomic, assign) double audioSampleRate; // Sample rate do áudio
@property (nonatomic, assign) UInt32 audioChannels; // Número de canais de áudio
@property (nonatomic, assign) size_t videoWidth; // Largura do vídeo
@property (nonatomic, assign) size_t videoHeight; // Altura do vídeo
@property (nonatomic, assign) pid_t monitoredPID;
@end

@implementation PowerPointStreamOutput

- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer ofType:(SCStreamOutputType)type {
    if (!self.captureState || !sampleBuffer) {
        return;
    }
    
    NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
    
    if (type == SCStreamOutputTypeAudio && self.isAudioOutput) {
        // Analisa o buffer de áudio para verificar se há dados reais
        CMBlockBufferRef blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer);
        if (blockBuffer) {
            size_t length = CMBlockBufferGetDataLength(blockBuffer);
            if (length > 0) {
                // Há dados de áudio
                char *data = NULL;
                CMBlockBufferGetDataPointer(blockBuffer, 0, NULL, NULL, &data);
                
                if (data) {
                    // Verifica se há sinal de áudio (não é silêncio)
                    BOOL hasAudioSignal = NO;
                    for (size_t i = 0; i < MIN(length, 1024); i += 2) {
                        int16_t sample = *(int16_t*)(data + i);
                        if (abs(sample) > 100) { // Threshold para detectar áudio (não silêncio)
                            hasAudioSignal = YES;
                            break;
                        }
                    }
                    
                    if (hasAudioSignal) {
                        self.captureState.hasAudioActivity = YES;
                        
                        // Primeira captura de áudio?
                        if (self.captureState.firstAudioTime == 0) {
                            self.captureState.firstAudioTime = now;
                            NSLog(@"🎵 ÁUDIO INICIADO! Primeira captura em: %.3f", now);
                        }
                        
                        // Calcula duração acumulada
                        self.captureState.audioDuration = now - self.captureState.firstAudioTime;
                        self.captureState.lastActivityTime = now;
                        self.captureState.audioFrameCount++;
                        
                        static NSTimeInterval lastLogTime = 0;
                        if (now - lastLogTime > 1.0) { // Log a cada 1 segundo
                            NSLog(@"🎵 ÁUDIO CAPTURADO! Tamanho: %zu bytes | Duração: %.2fs | Frames: %llu", 
                                  length, self.captureState.audioDuration, self.captureState.audioFrameCount);
                            lastLogTime = now;
                        }
                    }
                }
            }
        }
        
        // Também verifica formato de áudio e armazena informações
        CMAudioFormatDescriptionRef formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer);
        if (formatDescription) {
            const AudioStreamBasicDescription *asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription);
            if (asbd) {
                // Armazena informações de formato
                if (self.captureState.audioSampleRate == 0) {
                    self.captureState.audioSampleRate = asbd->mSampleRate;
                    self.captureState.audioChannels = asbd->mChannelsPerFrame;
                    NSLog(@"🎵 Formato de áudio detectado: %u canais, %.0f Hz, %d bits", 
                          (unsigned int)asbd->mChannelsPerFrame, asbd->mSampleRate, (int)(asbd->mBitsPerChannel ?: 16));
                }
            }
        }
    } else if (type == SCStreamOutputTypeScreen && !self.isAudioOutput) {
        // Analisa o buffer de vídeo
        CVImageBufferRef imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer);
        if (imageBuffer) {
            size_t width = CVPixelBufferGetWidth(imageBuffer);
            size_t height = CVPixelBufferGetHeight(imageBuffer);
            size_t bytesPerRow = CVPixelBufferGetBytesPerRow(imageBuffer);
            
            if (width > 0 && height > 0) {
                self.captureState.hasVideoActivity = YES;
                
                // Primeira captura de vídeo?
                if (self.captureState.firstVideoTime == 0) {
                    self.captureState.firstVideoTime = now;
                    self.captureState.videoWidth = width;
                    self.captureState.videoHeight = height;
                    NSLog(@"🎬 VÍDEO INICIADO! Primeira captura em: %.3f | Resolução: %zux%zu", now, width, height);
                }
                
                // Calcula duração acumulada
                self.captureState.videoDuration = now - self.captureState.firstVideoTime;
                self.captureState.lastActivityTime = now;
                self.captureState.videoFrameCount++;
                
                // Atualiza resolução se mudou
                self.captureState.videoWidth = width;
                self.captureState.videoHeight = height;
                
                static NSTimeInterval lastLogTime = 0;
                if (now - lastLogTime > 2.0) { // Log a cada 2 segundos
                    NSLog(@"🎬 VÍDEO CAPTURADO! Resolução: %zux%zu | Duração: %.2fs | Frames: %llu", 
                          width, height, self.captureState.videoDuration, self.captureState.videoFrameCount);
                    lastLogTime = now;
                }
                
                // Verifica se há mudança no frame (movimento)
                static uint64_t frameCount = 0;
                frameCount++;
                if (frameCount % 30 == 0) { // A cada 30 frames (~1 segundo a 30fps)
                    // Pode adicionar detecção de mudança de frame aqui
                    CVPixelBufferLockBaseAddress(imageBuffer, kCVPixelBufferLock_ReadOnly);
                    void *baseAddress = CVPixelBufferGetBaseAddress(imageBuffer);
                    if (baseAddress) {
                        // Frame válido com dados
                    }
                    CVPixelBufferUnlockBaseAddress(imageBuffer, kCVPixelBufferLock_ReadOnly);
                }
            }
        } else {
            // Pode ser CVPixelBuffer ou outro formato
            CMBlockBufferRef blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer);
            if (blockBuffer) {
                size_t length = CMBlockBufferGetDataLength(blockBuffer);
                if (length > 0) {
                    self.captureState.hasVideoActivity = YES;
                    
                    // Primeira captura de vídeo?
                    if (self.captureState.firstVideoTime == 0) {
                        self.captureState.firstVideoTime = now;
                        NSLog(@"🎬 VÍDEO INICIADO (block buffer)! Primeira captura em: %.3f", now);
                    }
                    
                    // Calcula duração acumulada
                    self.captureState.videoDuration = now - self.captureState.firstVideoTime;
                    self.captureState.lastActivityTime = now;
                    self.captureState.videoFrameCount++;
                    
                    static NSTimeInterval lastLogTime = 0;
                    if (now - lastLogTime > 2.0) {
                        NSLog(@"🎬 VÍDEO CAPTURADO (block buffer)! Tamanho: %zu bytes | Duração: %.2fs | Frames: %llu", 
                              length, self.captureState.videoDuration, self.captureState.videoFrameCount);
                        lastLogTime = now;
                    }
                }
            }
        }
    }
}

@end

@implementation AudioVideoCaptureState
@end

// Estado global de captura (singleton)
static AudioVideoCaptureState *g_captureState = nil;

// Função para verificar se ScreenCaptureKit está disponível (macOS 13.0+)
BOOL isScreenCaptureKitAvailable(void) {
    if (@available(macOS 13.0, *)) {
        return YES;
    }
    return NO;
}

// Função para iniciar monitoramento de áudio/vídeo do PowerPoint usando ScreenCaptureKit
BOOL startAudioVideoMonitoring(pid_t powerpointPID) {
    NSLog(@"🎬 startAudioVideoMonitoring chamada com PID: %d", powerpointPID);
    
    if (powerpointPID == 0) {
        NSLog(@"❌ PID é 0");
        return NO;
    }
    
    if (!isScreenCaptureKitAvailable()) {
        NSLog(@"❌ ScreenCaptureKit não disponível (requer macOS 13.0+)");
        return NO;
    }
    
    NSLog(@"✅ ScreenCaptureKit está disponível");
    
    // Se já está monitorando o mesmo processo, retorna sucesso
    if (g_captureState && g_captureState.isMonitoring && g_captureState.monitoredPID == powerpointPID) {
        NSLog(@"✅ Já está monitorando o mesmo processo");
        return YES;
    }
    
    // Para monitoramento anterior se existir
    if (g_captureState && g_captureState.isMonitoring) {
        if (g_captureState.stream) {
            [g_captureState.stream stopCaptureWithCompletionHandler:^(NSError *error) {
                if (error) {
                    NSLog(@"Erro ao parar captura: %@", error);
                }
            }];
        }
        g_captureState.isMonitoring = NO;
    }
    
    // Inicializa estado se necessário
    if (!g_captureState) {
        g_captureState = [[AudioVideoCaptureState alloc] init];
    }
    
    g_captureState.hasAudioActivity = NO;
    g_captureState.hasVideoActivity = NO;
    g_captureState.lastActivityTime = 0;
    g_captureState.firstAudioTime = 0;
    g_captureState.firstVideoTime = 0;
    g_captureState.audioDuration = 0;
    g_captureState.videoDuration = 0;
    g_captureState.audioFrameCount = 0;
    g_captureState.videoFrameCount = 0;
    g_captureState.audioSampleRate = 0;
    g_captureState.audioChannels = 0;
    g_captureState.videoWidth = 0;
    g_captureState.videoHeight = 0;
    g_captureState.monitoredPID = powerpointPID;
    
    if (@available(macOS 13.0, *)) {
        NSLog(@"📡 Chamando SCShareableContent.getShareableContent...");
        // Busca conteúdo compartilhável para encontrar a janela do PowerPoint
        [SCShareableContent getShareableContentExcludingDesktopWindows:YES
                                                      onScreenWindowsOnly:NO
                                                           completionHandler:^(SCShareableContent *content, NSError *error) {
            NSLog(@"📡 completionHandler do getShareableContent chamado");
            if (error) {
                NSLog(@"❌ Erro ao obter conteúdo compartilhável: %@", error);
                NSLog(@"💡 Verifique as permissões de captura de tela em: Sistema > Privacidade e Segurança > Gravação do Áudio do Sistema e da Tela");
                return;
            }
            
            NSLog(@"📋 Total de janelas encontradas: %lu", (unsigned long)content.windows.count);
            
            // Encontra a janela do PowerPoint
            SCWindow *powerPointWindow = nil;
            for (SCWindow *window in content.windows) {
                if (window.owningApplication && window.owningApplication.processID == powerpointPID) {
                    // Prioriza janelas de apresentação (slideshow)
                    NSString *title = window.title ?: @"";
                    NSString *lowerTitle = [title lowercaseString];
                    if ([lowerTitle containsString:@"apresentação"] || 
                        [lowerTitle containsString:@"presentation"] ||
                        [lowerTitle containsString:@"slide show"] ||
                        title.length < 5) {
                        powerPointWindow = window;
                        break;
                    }
                    // Se não encontrou janela de apresentação, usa a primeira janela do PowerPoint
                    if (!powerPointWindow) {
                        powerPointWindow = window;
                    }
                }
            }
            
            if (!powerPointWindow) {
                NSLog(@"❌ Janela do PowerPoint não encontrada para PID %d", powerpointPID);
                NSLog(@"💡 Certifique-se de que o PowerPoint está aberto e visível");
                return;
            }
            
            NSLog(@"✅ Janela do PowerPoint encontrada: %@", powerPointWindow.title ?: @"(sem título)");
            
            // Cria filtro de conteúdo para capturar apenas a janela do PowerPoint
            SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:content.displays.firstObject
                                                                  excludingWindows:@[]
                                                                   exceptingWindows:@[powerPointWindow]];
            
            // Configura o stream para capturar áudio e vídeo
            SCStreamConfiguration *config = [[SCStreamConfiguration alloc] init];
            if (@available(macOS 13.0, *)) {
                config.capturesAudio = YES; // Captura áudio
                config.excludesCurrentProcessAudio = NO; // NÃO exclui - queremos capturar TUDO (incluindo PowerPoint)
            }
            config.width = 1920;
            config.height = 1080;
            config.minimumFrameInterval = CMTimeMake(1, 60); // 60 FPS para captura mais frequente
            config.queueDepth = 10; // Buffer maior
            config.showsCursor = NO;
            config.pixelFormat = kCVPixelFormatType_32BGRA;
            
            // Cria o stream
            NSError *streamError = nil;
            SCStream *stream = [[SCStream alloc] initWithFilter:filter
                                                  configuration:config
                                                       delegate:nil];
            
            // Cria objetos de output para áudio e vídeo
            PowerPointStreamOutput *audioOutput = [[PowerPointStreamOutput alloc] init];
            audioOutput.isAudioOutput = YES;
            audioOutput.captureState = g_captureState;
            g_captureState.audioOutput = audioOutput;
            
            PowerPointStreamOutput *videoOutput = [[PowerPointStreamOutput alloc] init];
            videoOutput.isAudioOutput = NO;
            videoOutput.captureState = g_captureState;
            g_captureState.videoOutput = videoOutput;
            
            // Adiciona output de áudio (se disponível no macOS 13.0+)
            if (@available(macOS 13.0, *)) {
                BOOL success = [stream addStreamOutput:audioOutput
                                                  type:SCStreamOutputTypeAudio
                                    sampleHandlerQueue:dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0)
                                                 error:&streamError];
                if (!success || streamError) {
                    NSLog(@"❌ Erro ao adicionar output de áudio: %@", streamError);
                    NSLog(@"💡 Áudio pode não estar disponível ou permissões podem estar faltando");
                } else {
                    NSLog(@"✅ Output de áudio adicionado com sucesso");
                }
            }
            
            // Adiciona output de vídeo
            BOOL success = [stream addStreamOutput:videoOutput
                                              type:SCStreamOutputTypeScreen
                                sampleHandlerQueue:dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0)
                                             error:&streamError];
            if (!success || streamError) {
                NSLog(@"❌ Erro ao adicionar output de vídeo: %@", streamError);
            } else {
                NSLog(@"✅ Output de vídeo adicionado com sucesso");
            }
            
            // Inicia captura
            [stream startCaptureWithCompletionHandler:^(NSError *error) {
                if (error) {
                    NSLog(@"❌ Erro ao iniciar captura ScreenCaptureKit: %@", error);
                    NSLog(@"💡 Erro code: %ld, domain: %@", (long)error.code, error.domain);
                    NSLog(@"💡 Verifique permissões de captura de tela em: Sistema > Privacidade e Segurança");
                    g_captureState.isMonitoring = NO;
                } else {
                    NSLog(@"✅ Captura ScreenCaptureKit iniciada com sucesso para PID %d", powerpointPID);
                    NSLog(@"🎯 Monitorando áudio e vídeo do PowerPoint...");
                    g_captureState.isMonitoring = YES;
                    g_captureState.stream = stream;
                }
            }];
        }];
        
        return YES;
    }
    
    return NO;
}

// Função para parar monitoramento
void stopAudioVideoMonitoring(void) {
    if (g_captureState && g_captureState.isMonitoring) {
        if (g_captureState.stream) {
            [g_captureState.stream stopCaptureWithCompletionHandler:^(NSError *error) {
                if (error) {
                    NSLog(@"Erro ao parar captura: %@", error);
                }
            }];
        }
        g_captureState.isMonitoring = NO;
        g_captureState.stream = nil;
    }
}

// Função para verificar permissões de captura de tela
BOOL checkScreenCapturePermissions(void) {
    if (@available(macOS 13.0, *)) {
        // Verifica se temos permissão de captura de tela
        // O macOS pode não solicitar automaticamente, então verificamos se conseguimos obter conteúdo
        __block BOOL hasPermission = NO;
        __block BOOL checkComplete = NO;
        
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
        
        [SCShareableContent getShareableContentExcludingDesktopWindows:YES
                                                      onScreenWindowsOnly:NO
                                                           completionHandler:^(SCShareableContent *content, NSError *error) {
            if (error) {
                // Se o erro for de permissão, não temos acesso
                if ([error.domain isEqualToString:@"com.apple.ScreenCaptureKit.error"] && error.code == -3801) {
                    NSLog(@"❌ PERMISSÃO DE CAPTURA DE TELA NEGADA!");
                    NSLog(@"💡 Vá em: Sistema > Privacidade e Segurança > Gravação do Áudio do Sistema e da Tela");
                    NSLog(@"💡 Ative para: Terminal ou Node.js");
                } else {
                    NSLog(@"❌ Erro ao verificar permissões: %@ (code: %ld)", error, (long)error.code);
                }
                hasPermission = NO;
            } else {
                hasPermission = YES;
                NSLog(@"✅ Permissões de captura de tela OK");
            }
            checkComplete = YES;
            dispatch_semaphore_signal(semaphore);
        }];
        
        // Aguarda resposta (timeout de 2 segundos)
        dispatch_time_t timeout = dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC);
        if (dispatch_semaphore_wait(semaphore, timeout) != 0) {
            NSLog(@"⚠️ Timeout ao verificar permissões");
            return NO;
        }
        
        return hasPermission;
    }
    return NO;
}

// Declaração de funções de baixo nível (implementadas no arquivo separado ou inline)
// Para captura em baixo nível, vamos usar uma abordagem diferente
// que monitora o dispositivo de saída de áudio do sistema

// Função para detectar se há áudio sendo reproduzido do PowerPoint
BOOL isAudioPlayingFromPowerPoint(pid_t powerpointPID) {
    NSLog(@"🔍 isAudioPlayingFromPowerPoint chamada com PID: %d", powerpointPID);
    
    if (powerpointPID == 0) {
        NSLog(@"❌ PID é 0 - PowerPoint não encontrado");
        return NO;
    }
    
    // Verifica permissões primeiro
    static BOOL permissionsChecked = NO;
    if (!permissionsChecked) {
        NSLog(@"🔍 Verificando permissões de captura de tela...");
        BOOL hasPermission = checkScreenCapturePermissions();
        NSLog(@"🔍 Resultado da verificação de permissões: %@", hasPermission ? @"SIM" : @"NÃO");
        if (!hasPermission) {
            NSLog(@"⚠️ Sem permissões - interceptação de áudio/vídeo não funcionará");
            NSLog(@"💡 Vá em: Sistema > Privacidade e Segurança > Gravação do Áudio do Sistema e da Tela");
            NSLog(@"💡 Ative para: Terminal ou Node.js");
            return NO;
        }
        permissionsChecked = YES;
        NSLog(@"✅ Permissões OK!");
    }
    
    // Tenta iniciar monitoramento se não estiver ativo
    if (!g_captureState) {
        NSLog(@"⚠️ g_captureState é nil - criando novo estado...");
    } else {
        NSLog(@"📊 Estado atual: isMonitoring=%d, monitoredPID=%d", g_captureState.isMonitoring, g_captureState.monitoredPID);
    }
    
    if (!g_captureState || !g_captureState.isMonitoring || g_captureState.monitoredPID != powerpointPID) {
        NSLog(@"🎯 Iniciando monitoramento ScreenCaptureKit para PID %d...", powerpointPID);
        BOOL started = startAudioVideoMonitoring(powerpointPID);
        NSLog(@"🎯 startAudioVideoMonitoring retornou: %@", started ? @"SIM" : @"NÃO");
        // Aguarda mais tempo para permitir que o stream seja configurado (assíncrono)
        NSLog(@"⏳ Aguardando 1.5 segundos para setup assíncrono...");
        usleep(1500000); // 1.5 segundos - dá tempo para setup assíncrono
        NSLog(@"⏳ Aguardou 1.5 segundos");
    }
    
    NSLog(@"📊 Verificando estado após tentativa de inicialização...");
    if (g_captureState) {
        NSLog(@"📊 g_captureState existe: isMonitoring=%d", g_captureState.isMonitoring);
    } else {
        NSLog(@"❌ g_captureState ainda é nil após tentativa de inicialização");
    }
    
    if (g_captureState && g_captureState.isMonitoring) {
        NSLog(@"✅ Monitoramento está ativo!");
        // Verifica se houve atividade de áudio nos últimos 2 segundos
        NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
        NSTimeInterval timeSinceActivity = now - g_captureState.lastActivityTime;
        
        NSLog(@"📊 hasAudioActivity=%d, timeSinceActivity=%.2f", g_captureState.hasAudioActivity, timeSinceActivity);
        
        if (g_captureState.hasAudioActivity && timeSinceActivity < 2.0) {
            // Usa duração acumulada calculada durante a captura
            if (g_captureState.audioDuration > 0) {
                NSLog(@"🎵 Áudio detectado via ScreenCaptureKit! Duração: %.2fs | Sample Rate: %.0f Hz | Canais: %u", 
                      g_captureState.audioDuration, 
                      g_captureState.audioSampleRate > 0 ? g_captureState.audioSampleRate : 0,
                      (unsigned int)g_captureState.audioChannels);
            } else {
                NSLog(@"🎵 Áudio detectado via ScreenCaptureKit!");
            }
            return YES;
        } else {
            NSLog(@"⚠️ Sem atividade de áudio recente: hasAudioActivity=%d, timeSinceActivity=%.2f", 
                  g_captureState.hasAudioActivity, timeSinceActivity);
        }
    } else {
        // Se não está monitorando, pode ser problema de permissões ou setup
        static NSTimeInterval lastWarningTime = 0;
        NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
        if (now - lastWarningTime > 5.0) { // Avisa a cada 5 segundos
            NSLog(@"⚠️ ScreenCaptureKit não está monitorando (pode ser problema de permissões ou setup)");
            lastWarningTime = now;
        }
    }
    
    return NO;
}

// Função para detectar se há vídeo sendo reproduzido
BOOL isVideoPlayingFromPowerPoint(pid_t powerpointPID) {
    if (powerpointPID == 0) {
        return NO;
    }
    
    // Verifica permissões primeiro (compartilha o mesmo check com áudio)
    static BOOL permissionsChecked = NO;
    if (!permissionsChecked) {
        if (!checkScreenCapturePermissions()) {
            return NO;
        }
        permissionsChecked = YES;
    }
    
    // Tenta iniciar monitoramento se não estiver ativo
    if (!g_captureState || !g_captureState.isMonitoring || g_captureState.monitoredPID != powerpointPID) {
        NSLog(@"🎯 Iniciando monitoramento ScreenCaptureKit para PID %d...", powerpointPID);
        startAudioVideoMonitoring(powerpointPID);
        usleep(1500000); // 1.5 segundos
    }
    
    if (g_captureState && g_captureState.isMonitoring) {
        NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
        NSTimeInterval timeSinceActivity = now - g_captureState.lastActivityTime;
        
        if (g_captureState.hasVideoActivity && timeSinceActivity < 2.0) {
            // Usa duração acumulada calculada durante a captura
            if (g_captureState.videoDuration > 0) {
                NSLog(@"🎬 Vídeo detectado via ScreenCaptureKit! Duração: %.2fs | Resolução: %zux%zu | Frames: %llu", 
                      g_captureState.videoDuration,
                      g_captureState.videoWidth,
                      g_captureState.videoHeight,
                      g_captureState.videoFrameCount);
            } else {
                NSLog(@"🎬 Vídeo detectado via ScreenCaptureKit!");
            }
            return YES;
        }
    }
    
    return NO;
}

// Função auxiliar para obter duração do vídeo extraindo do arquivo .pptx
double getVideoDurationFromPPTX(NSString* pptxPath, NSString* videoFileName) {
    if (!pptxPath || [pptxPath length] == 0) {
        return 0.0;
    }
    
    @try {
        // .pptx é um arquivo ZIP
        // Tenta extrair o vídeo temporariamente para obter a duração
        NSTask *unzipTask = [[NSTask alloc] init];
        [unzipTask setLaunchPath:@"/usr/bin/unzip"];
        
        // Cria diretório temporário
        NSString *tempDir = [NSTemporaryDirectory() stringByAppendingPathComponent:[[NSUUID UUID] UUIDString]];
        [[NSFileManager defaultManager] createDirectoryAtPath:tempDir withIntermediateDirectories:YES attributes:nil error:nil];
        
        // Extrai todos os arquivos de mídia do .pptx (estão em ppt/media/)
        // Primeiro tenta extrair apenas a pasta media
        @try {
            NSTask *extractTask = [[NSTask alloc] init];
            [extractTask setLaunchPath:@"/usr/bin/unzip"];
            [extractTask setArguments:@[@"-q", @"-o", pptxPath, @"ppt/media/*", @"-d", tempDir]];
            [extractTask setStandardOutput:[NSPipe pipe]];
            [extractTask setStandardError:[NSPipe pipe]];
            [extractTask launch];
            [extractTask waitUntilExit];
            
            // Se não encontrou em ppt/media, tenta extrair tudo
            if ([extractTask terminationStatus] != 0) {
                @try {
                    NSTask *extractAllTask = [[NSTask alloc] init];
                    [extractAllTask setLaunchPath:@"/usr/bin/unzip"];
                    [extractAllTask setArguments:@[@"-q", @"-o", pptxPath, @"-d", tempDir]];
                    [extractAllTask setStandardOutput:[NSPipe pipe]];
                    [extractAllTask setStandardError:[NSPipe pipe]];
                    [extractAllTask launch];
                    [extractAllTask waitUntilExit];
                } @catch (NSException *e2) {
                    // Ignora
                }
            }
        } @catch (NSException *e) {
            // Ignora erros - tenta buscar mesmo assim
        }
        
        // Busca arquivos de vídeo no diretório extraído
        // Busca RECURSIVAMENTE em TODAS as pastas, não apenas ppt/media/
        NSArray *videoExtensions = @[@"mp4", @"mov", @"avi", @"m4v", @"wmv", @"flv", @"mkv", @"webm", @"mpg", @"mpeg"];
        
        // Usa enumerator recursivo para buscar em TODOS os diretórios
        NSDirectoryEnumerator *enumerator = [[NSFileManager defaultManager] enumeratorAtPath:tempDir];
        NSString *foundPath;
        
        while ((foundPath = [enumerator nextObject])) {
            NSString *fullPath = [tempDir stringByAppendingPathComponent:foundPath];
            BOOL isDir;
            if ([[NSFileManager defaultManager] fileExistsAtPath:fullPath isDirectory:&isDir] && !isDir) {
                NSString *fileName = [foundPath lastPathComponent];
                NSString *extension = [[fileName pathExtension] lowercaseString];
                
                // Verifica se é um arquivo de vídeo
                if ([videoExtensions containsObject:extension]) {
                    // Se temos um nome específico para procurar, compara
                    BOOL shouldCheck = YES;
                    if (videoFileName && [videoFileName length] > 0) {
                        // Compara nome sem extensão (o PowerPoint pode renomear)
                        NSString *videoNameNoExt = [[videoFileName stringByDeletingPathExtension] lowercaseString];
                        NSString *foundNameNoExt = [[fileName stringByDeletingPathExtension] lowercaseString];
                        
                        // Remove caracteres especiais e espaços para comparação mais flexível
                        NSCharacterSet *charsToRemove = [[NSCharacterSet alphanumericCharacterSet] invertedSet];
                        NSString *videoNameClean = [[videoNameNoExt componentsSeparatedByCharactersInSet:charsToRemove] componentsJoinedByString:@""];
                        NSString *foundNameClean = [[foundNameNoExt componentsSeparatedByCharactersInSet:charsToRemove] componentsJoinedByString:@""];
                        
                        // Compara substrings comuns ou aceita se não temos nome específico
                        if ([videoNameClean length] > 0 && [foundNameClean length] > 0) {
                            // Se pelo menos 30% do nome corresponde, aceita
                            NSInteger minLength = MIN([videoNameClean length], [foundNameClean length]);
                            NSInteger matches = 0;
                            for (NSInteger i = 0; i < minLength && i < MIN(20, minLength); i++) {
                                if ([videoNameClean characterAtIndex:i] == [foundNameClean characterAtIndex:i]) {
                                    matches++;
                                }
                            }
                            shouldCheck = (matches > minLength * 0.3); // Pelo menos 30% de correspondência
                        } else {
                            shouldCheck = YES; // Se não conseguiu limpar, tenta mesmo assim
                        }
                    }
                    
                    // Se não temos nome específico ou o nome corresponde, tenta obter duração
                    if (shouldCheck || !videoFileName || [videoFileName length] == 0) {
                        @try {
                            NSURL *videoURL = [NSURL fileURLWithPath:fullPath];
                            AVURLAsset *asset = [AVURLAsset URLAssetWithURL:videoURL options:nil];
                            CMTime duration = asset.duration;
                            
                            // Se duration é válido e não é kCMTimeInvalid
                            if (CMTIME_IS_VALID(duration) && !CMTIME_IS_INVALID(duration)) {
                                double durationSeconds = CMTimeGetSeconds(duration);
                                
                                if (durationSeconds > 0 && !isnan(durationSeconds) && !isinf(durationSeconds)) {
                                    // Limpa arquivos temporários antes de retornar
                                    [[NSFileManager defaultManager] removeItemAtPath:tempDir error:nil];
                                    return durationSeconds;
                                }
                            }
                        } @catch (NSException *e) {
                            // Continua procurando
                        }
                    }
                }
            }
        }
        
        // Limpa arquivos temporários
        [[NSFileManager defaultManager] removeItemAtPath:tempDir error:nil];
    } @catch (NSException *e) {
        // Ignora erros
    }
    
    return 0.0;
}

// Função auxiliar para obter duração do vídeo a partir do caminho do arquivo
double getVideoDurationFromFile(NSString* filePath) {
    if (!filePath || [filePath length] == 0) {
        return 0.0;
    }
    
    @try {
        // Tenta obter duração usando AVFoundation
        NSURL *videoURL = nil;
        NSString *pathToTry = filePath;
        
        // Remove espaços extras e limpa o caminho
        pathToTry = [pathToTry stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
        
        // Se for um caminho de arquivo, cria NSURL
        if ([pathToTry hasPrefix:@"file://"]) {
            videoURL = [NSURL URLWithString:pathToTry];
        } else if ([pathToTry hasPrefix:@"/"]) {
            videoURL = [NSURL fileURLWithPath:pathToTry];
        } else {
            // Tenta criar URL a partir do caminho relativo
            pathToTry = [pathToTry stringByExpandingTildeInPath];
            videoURL = [NSURL fileURLWithPath:pathToTry];
        }
        
        // Verifica se o arquivo existe
        NSString *finalPath = [videoURL path];
        if (finalPath && [[NSFileManager defaultManager] fileExistsAtPath:finalPath]) {
            AVURLAsset *asset = [AVURLAsset URLAssetWithURL:videoURL options:nil];
            
            // Tenta obter duração de forma síncrona (pode ser lento, mas necessário)
            // AVAsset tem duration disponível imediatamente na maioria dos casos
            CMTime duration = asset.duration;
            double durationSeconds = CMTimeGetSeconds(duration);
            
            if (durationSeconds > 0 && !isnan(durationSeconds) && !isinf(durationSeconds)) {
                return durationSeconds;
            }
            
            // Se não funcionou, tenta carregar propriedades de forma assíncrona
            // Mas como não podemos esperar, vamos tentar apenas a duração direta
        } else {
            // Arquivo não encontrado no caminho direto
            // Tenta buscar em locais comuns do PowerPoint (Downloads, Documents, etc.)
            NSArray *searchPaths = @[
                [@"~/Downloads" stringByExpandingTildeInPath],
                [@"~/Documents" stringByExpandingTildeInPath],
                [@"~/Movies" stringByExpandingTildeInPath],
                [@"~/Desktop" stringByExpandingTildeInPath],
                @"/Users"
            ];
            
            NSString *fileName = [pathToTry lastPathComponent];
            
            for (NSString *searchPath in searchPaths) {
                @try {
                    // Busca recursivamente pelo nome do arquivo
                    NSDirectoryEnumerator *enumerator = [[NSFileManager defaultManager] enumeratorAtPath:searchPath];
                    NSString *foundPath;
                    while ((foundPath = [enumerator nextObject])) {
                        if ([[foundPath lastPathComponent] isEqualToString:fileName]) {
                            NSString *fullPath = [searchPath stringByAppendingPathComponent:foundPath];
                            NSURL *foundURL = [NSURL fileURLWithPath:fullPath];
                            
                            AVURLAsset *asset = [AVURLAsset URLAssetWithURL:foundURL options:nil];
                            CMTime duration = asset.duration;
                            double durationSeconds = CMTimeGetSeconds(duration);
                            
                            if (durationSeconds > 0 && !isnan(durationSeconds) && !isinf(durationSeconds)) {
                                return durationSeconds;
                            }
                            break; // Encontrou mas não conseguiu duração, para a busca
                        }
                    }
                } @catch (NSException *e) {
                    // Continua procurando
                }
            }
        }
    } @catch (NSException *e) {
        // Ignora erros
    }
    
    return 0.0;
}

// Função para buscar informações de vídeo em reprodução na janela (versão simplificada e protegida)
NSDictionary* findVideoInfoInWindow(AXUIElementRef window) {
    NSMutableDictionary *videoInfo = [NSMutableDictionary dictionary];
    videoInfo[@"hasVideo"] = @NO;
    videoInfo[@"isPlaying"] = @NO;
    videoInfo[@"duration"] = @0.0;
    videoInfo[@"currentTime"] = @0.0;
    videoInfo[@"remainingTime"] = @0.0;
    videoInfo[@"volume"] = @0.0;
    videoInfo[@"muted"] = @NO;
    videoInfo[@"fileName"] = @"";
    videoInfo[@"sourceUrl"] = @"";
    
    if (!window) {
        return videoInfo;
    }
    
    @try {
        // Função recursiva auxiliar para buscar profundamente
        __block void (^searchRecursively)(AXUIElementRef, NSInteger);
        searchRecursively = ^(AXUIElementRef element, NSInteger depth) {
            if (depth > 8) return; // Limita profundidade
            
            CFArrayRef children;
            AXError err = AXUIElementCopyAttributeValues(element, kAXChildrenAttribute, 0, 300, &children);
            
            if (err != kAXErrorSuccess || !children) {
                return;
            }
            
            CFIndex count = CFArrayGetCount(children);
            if (count > 300) count = 300;
            
            for (CFIndex i = 0; i < count; i++) {
            @try {
                AXUIElementRef child = (AXUIElementRef)CFArrayGetValueAtIndex(children, i);
                if (!child) continue;
                
                // Verifica se é um elemento de mídia/vídeo
                CFStringRef role = NULL;
                err = AXUIElementCopyAttributeValue(child, kAXRoleAttribute, (CFTypeRef*)&role);
                
                NSString *roleStr = nil;
                if (err == kAXErrorSuccess && role) {
                    roleStr = CFStringToNSString(role);
                }
                
                // Procura por elementos de mídia
                BOOL isMediaElement = NO;
                if (roleStr) {
                    NSString *lowerRole = [roleStr lowercaseString];
                    isMediaElement = ([lowerRole containsString:@"media"] || 
                                     [lowerRole containsString:@"video"] || 
                                     [lowerRole containsString:@"movie"] ||
                                     [lowerRole containsString:@"player"]);
                }
                
                // Se encontrou possível elemento de mídia, tenta obter propriedades de vídeo
                if (isMediaElement) {
                    videoInfo[@"hasVideo"] = @YES;
                    
                    // Tenta obter informações de reprodução usando diferentes atributos
                    // Lista expandida de atributos possíveis da Accessibility API
                    NSArray *durationAttrs = @[@"AXDuration", @"duration", @"AXMediaDuration", 
                                               @"AXLength", @"length", @"totalDuration",
                                               @"AXValueDescription", @"AXValue"];
                    NSArray *currentTimeAttrs = @[@"AXCurrentTime", @"currentTime", @"AXMediaCurrentTime",
                                                  @"AXPosition", @"position", @"timePosition",
                                                  @"AXProgressValue", @"progressValue"];
                    NSArray *playingAttrs = @[@"AXPlaying", @"playing", @"AXMediaPlaying",
                                              @"AXPaused", @"paused", @"isPlaying",
                                              @"AXValue", @"value"];
                    
                    // Tenta obter duração total
                    for (NSString *attr in durationAttrs) {
                        @try {
                            CFTypeRef durationRef = NULL;
                            err = AXUIElementCopyAttributeValue(child, (__bridge CFStringRef)attr, &durationRef);
                            if (err == kAXErrorSuccess && durationRef) {
                                if (CFGetTypeID(durationRef) == CFNumberGetTypeID()) {
                                    double duration = 0.0;
                                    CFNumberGetValue((CFNumberRef)durationRef, kCFNumberDoubleType, &duration);
                                    if (duration > 0) {
                                        videoInfo[@"duration"] = @(duration);
                                        CFRelease(durationRef);
                                        break;
                                    }
                                }
                                CFRelease(durationRef);
                            }
                        } @catch (NSException *e) {
                            // Ignora erros ao acessar atributos
                        }
                    }
                    
                    // Tenta obter tempo atual
                    for (NSString *attr in currentTimeAttrs) {
                        @try {
                            CFTypeRef currentTimeRef = NULL;
                            err = AXUIElementCopyAttributeValue(child, (__bridge CFStringRef)attr, &currentTimeRef);
                            if (err == kAXErrorSuccess && currentTimeRef) {
                                // Tenta como número
                                if (CFGetTypeID(currentTimeRef) == CFNumberGetTypeID()) {
                                    double currentTime = 0.0;
                                    CFNumberGetValue((CFNumberRef)currentTimeRef, kCFNumberDoubleType, &currentTime);
                                    if (currentTime >= 0) {
                                        videoInfo[@"currentTime"] = @(currentTime);
                                        
                                        // Calcula tempo restante
                                        double duration = [videoInfo[@"duration"] doubleValue];
                                        if (duration > 0) {
                                            double remaining = duration - currentTime;
                                            videoInfo[@"remainingTime"] = @(remaining > 0 ? remaining : 0.0);
                                        }
                                        CFRelease(currentTimeRef);
                                        break;
                                    }
                                }
                                // Tenta como string (pode estar formatado como "00:01:23")
                                else if (CFGetTypeID(currentTimeRef) == CFStringGetTypeID()) {
                                    NSString *timeStr = CFStringToNSString((CFStringRef)currentTimeRef);
                                    // Tenta parsear formato HH:MM:SS ou MM:SS
                                    NSArray *components = [timeStr componentsSeparatedByString:@":"];
                                    if ([components count] >= 2) {
                                        double seconds = 0.0;
                                        double multiplier = 1.0;
                                        for (NSInteger i = [components count] - 1; i >= 0; i--) {
                                            double value = [[components objectAtIndex:i] doubleValue];
                                            seconds += value * multiplier;
                                            multiplier *= 60.0;
                                        }
                                        if (seconds >= 0) {
                                            videoInfo[@"currentTime"] = @(seconds);
                                            
                                            double duration = [videoInfo[@"duration"] doubleValue];
                                            if (duration > 0) {
                                                double remaining = duration - seconds;
                                                videoInfo[@"remainingTime"] = @(remaining > 0 ? remaining : 0.0);
                                            }
                                            CFRelease(currentTimeRef);
                                            break;
                                        }
                                    }
                                }
                                CFRelease(currentTimeRef);
                            }
                        } @catch (NSException *e) {
                            // Ignora erros ao acessar atributos
                        }
                    }
                    
                    // Verifica se está reproduzindo
                    for (NSString *attr in playingAttrs) {
                        @try {
                            CFTypeRef playingRef = NULL;
                            err = AXUIElementCopyAttributeValue(child, (__bridge CFStringRef)attr, &playingRef);
                            if (err == kAXErrorSuccess && playingRef) {
                                if (CFGetTypeID(playingRef) == CFBooleanGetTypeID()) {
                                    videoInfo[@"isPlaying"] = @(CFBooleanGetValue((CFBooleanRef)playingRef));
                                }
                                CFRelease(playingRef);
                                break;
                            }
                        } @catch (NSException *e) {
                            // Ignora erros ao acessar atributos
                        }
                    }
                    
                    // Se encontrou vídeo com duração, pode parar
                    if ([videoInfo[@"duration"] doubleValue] > 0) {
                        if (role) CFRelease(role);
                        CFRelease(children);
                        return;
                    }
                }
                
                if (role) {
                    CFRelease(role);
                    role = NULL;
                }
                
                // Busca recursivamente em filhos (se ainda não encontrou vídeo completo)
                if (![videoInfo[@"hasVideo"] boolValue] || [videoInfo[@"duration"] doubleValue] == 0.0) {
                    searchRecursively(child, depth + 1);
                }
            } @catch (NSException *e) {
                // Ignora erros ao processar um filho específico
            }
            
            // Se já encontrou vídeo completo, pode parar
            if ([videoInfo[@"hasVideo"] boolValue] && [videoInfo[@"duration"] doubleValue] > 0) {
                CFRelease(children);
                return;
            }
        }
        
        CFRelease(children);
        };
        
        // Inicia busca recursiva
        searchRecursively(window, 0);
    } @catch (NSException *e) {
        // Ignora erros gerais
    }
    
    return videoInfo;
}

// Função para buscar elementos de texto na janela do PowerPoint
NSInteger findSlideNumberInWindow(AXUIElementRef window) {
    CFArrayRef children;
    AXError err = AXUIElementCopyAttributeValues(window, kAXChildrenAttribute, 0, 100, &children);
    
    if (err != kAXErrorSuccess || !children) {
        return 0;
    }
    
    CFIndex count = CFArrayGetCount(children);
    
    for (CFIndex i = 0; i < count; i++) {
        AXUIElementRef child = (AXUIElementRef)CFArrayGetValueAtIndex(children, i);
        
        // Obtém o texto do elemento
        CFStringRef title;
        err = AXUIElementCopyAttributeValue(child, kAXTitleAttribute, (CFTypeRef*)&title);
        if (err == kAXErrorSuccess && title) {
            NSString *titleStr = CFStringToNSString(title);
            
            // Procura por padrões de número de slide (ex: "Slide 5", "5 de 16", etc)
            NSRegularExpression *regex = [NSRegularExpression regularExpressionWithPattern:@"(?:Slide|slide|Slide)\\s*(\\d+)" options:0 error:nil];
            NSTextCheckingResult *match = [regex firstMatchInString:titleStr options:0 range:NSMakeRange(0, [titleStr length])];
            
            if (match) {
                NSRange slideRange = [match rangeAtIndex:1];
                NSString *slideNumStr = [titleStr substringWithRange:slideRange];
                NSInteger slideNum = [slideNumStr integerValue];
                CFRelease(title);
                CFRelease(children);
                return slideNum;
            }
            
            // Tenta padrão "X de Y"
            regex = [NSRegularExpression regularExpressionWithPattern:@"(\\d+)\\s*(?:de|of|/)\\s*\\d+" options:0 error:nil];
            match = [regex firstMatchInString:titleStr options:0 range:NSMakeRange(0, [titleStr length])];
            
            if (match) {
                NSRange slideRange = [match rangeAtIndex:1];
                NSString *slideNumStr = [titleStr substringWithRange:slideRange];
                NSInteger slideNum = [slideNumStr integerValue];
                CFRelease(title);
                CFRelease(children);
                return slideNum;
            }
            
            CFRelease(title);
        }
        
        // Busca recursivamente nos filhos
        NSInteger found = findSlideNumberInWindow(child);
        if (found > 0) {
            CFRelease(children);
            return found;
        }
    }
    
    CFRelease(children);
    return 0;
}

Napi::Object GetPowerPointStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    
    @autoreleasepool {
        @try {
            // Obtém PID do PowerPoint usando NSWorkspace
            pid_t pid = 0;
            NSArray *runningApps = [NSWorkspace sharedWorkspace].runningApplications;
            for (NSRunningApplication *app in runningApps) {
                NSString *bundleId = app.bundleIdentifier;
                if (bundleId && ([bundleId isEqualToString:@"com.microsoft.Powerpoint"] || 
                                 [bundleId isEqualToString:@"com.microsoft.PowerPoint"])) {
                    pid = app.processIdentifier;
                    break;
                }
            }
            
            if (pid == 0) {
                result.Set("isAvailable", Napi::Boolean::New(env, false));
                result.Set("error", Napi::String::New(env, "PowerPoint não está aberto"));
                return result;
            }
            
            // Verifica PowerPoint via Scripting Bridge
            SBApplication *powerpoint = [SBApplication applicationWithBundleIdentifier:@"com.microsoft.Powerpoint"];
            
            // Método 2: Usa Accessibility API para inspecionar a janela
            AXUIElementRef app = AXUIElementCreateApplication(pid);
            
            CFArrayRef windows;
            AXError err = AXUIElementCopyAttributeValues(app, kAXWindowsAttribute, 0, 100, &windows);
            
            NSInteger slideCount = 0;
            NSInteger currentSlide = 0;
            BOOL isInSlideShow = false;
            NSDictionary *videoInfo = nil;
            
            if (err == kAXErrorSuccess && windows) {
                CFIndex windowCount = CFArrayGetCount(windows);
                
                for (CFIndex i = 0; i < windowCount; i++) {
                    AXUIElementRef window = (AXUIElementRef)CFArrayGetValueAtIndex(windows, i);
                    
                    // Obtém título da janela
                    CFStringRef title;
                    err = AXUIElementCopyAttributeValue(window, kAXTitleAttribute, (CFTypeRef*)&title);
                    
                    if (err == kAXErrorSuccess && title) {
                        NSString *titleStr = CFStringToNSString(title);
                        
                        // Verifica se é janela de apresentação (critérios mais amplos)
                        NSString *lowerTitle = [titleStr lowercaseString];
                        BOOL isSlideShowWindow = ([lowerTitle containsString:@"apresentação"] || 
                                                 [lowerTitle containsString:@"presentation"] ||
                                                 [lowerTitle containsString:@"slide show"] ||
                                                 [lowerTitle containsString:@"slideshow"] ||
                                                 [lowerTitle containsString:@"full screen"] ||
                                                 [lowerTitle containsString:@"fullscreen"] ||
                                                 // Verifica se é uma janela sem título ou com título muito curto (comum em apresentações)
                                                 [titleStr length] < 5 ||
                                                 // Verifica se contém números (indicando slide)
                                                 [titleStr rangeOfCharacterFromSet:[NSCharacterSet decimalDigitCharacterSet]].location != NSNotFound);
                        
                        if (isSlideShowWindow) {
                            isInSlideShow = true;
                            
                            // Tenta encontrar número do slide na interface
                            currentSlide = findSlideNumberInWindow(window);
                            
                            // Busca informações de vídeo em reprodução (com proteção)
                            @try {
                                videoInfo = findVideoInfoInWindow(window);
                            } @catch (NSException *e) {
                                // Ignora erros na busca de vídeo
                            }
                            
                            // Tenta extrair do título também
                            if (currentSlide == 0) {
                                NSRegularExpression *regex = [NSRegularExpression regularExpressionWithPattern:@"(\\d+)" options:0 error:nil];
                                NSArray *matches = [regex matchesInString:titleStr options:0 range:NSMakeRange(0, [titleStr length])];
                                if ([matches count] > 0) {
                                    NSTextCheckingResult *match = matches[0];
                                    NSString *numStr = [titleStr substringWithRange:[match range]];
                                    currentSlide = [numStr integerValue];
                                }
                            }
                        }
                        
                        // SEMPRE busca vídeo e slide atual em TODAS as janelas (mesmo não sendo apresentação)
                        if (currentSlide == 0) {
                            currentSlide = findSlideNumberInWindow(window);
                        }
                        
                        // Busca informações de vídeo em TODAS as janelas (com proteção)
                        if (!videoInfo || ![videoInfo[@"hasVideo"] boolValue]) {
                            @try {
                                NSDictionary *foundVideo = findVideoInfoInWindow(window);
                                if (foundVideo && [foundVideo[@"hasVideo"] boolValue]) {
                                    videoInfo = foundVideo;
                                }
                            } @catch (NSException *e) {
                                // Ignora erros na busca de vídeo
                            }
                        }
                        
                        CFRelease(title);
                    } else {
                        // Mesmo sem título, tenta detectar vídeo e slide (com proteção)
                        if (currentSlide == 0) {
                            @try {
                                currentSlide = findSlideNumberInWindow(window);
                            } @catch (NSException *e) {
                                // Ignora erros
                            }
                        }
                        
                        if (!videoInfo) {
                            @try {
                                videoInfo = findVideoInfoInWindow(window);
                            } @catch (NSException *e) {
                                // Ignora erros
                            }
                        }
                    }
                }
                
                CFRelease(windows);
            }
            
            CFRelease(app);
            
            // Método 3: Obtém informações via Scripting Bridge e AppleScript
            NSInteger visibleSlideCount = 0;
            NSMutableArray *hiddenSlideNumbers = [NSMutableArray array];
            
            @try {
                id<NSObject> pptApp = (id<NSObject>)powerpoint;
                if ([pptApp respondsToSelector:@selector(activePresentation)]) {
                    id activePres = [pptApp performSelector:@selector(activePresentation)];
                    
                    // Tenta obter o caminho do arquivo .pptx via AppleScript (mais confiável)
                    NSString *pptxPath = nil;
                    @try {
                        // Primeiro tenta via Scripting Bridge
                        id fullName = [activePres valueForKey:@"fullName"];
                        if (!fullName && [activePres respondsToSelector:@selector(fullName)]) {
                            fullName = [activePres performSelector:@selector(fullName)];
                        }
                        
                        if (fullName) {
                            if ([fullName isKindOfClass:[NSString class]]) {
                                pptxPath = (NSString*)fullName;
                            } else if ([fullName respondsToSelector:@selector(stringValue)]) {
                                pptxPath = [fullName stringValue];
                            }
                        }
                        
                        // Se não conseguiu via Scripting Bridge, tenta via AppleScript
                        if (!pptxPath || [pptxPath length] == 0) {
                            NSString *applescriptPath = @"tell application \"Microsoft Powerpoint\"\n"
                                                        @"\ttell active presentation\n"
                                                        @"\t\treturn full name of it\n"
                                                        @"\tend tell\n"
                                                        @"end tell\n";
                            
                            NSAppleScript *script = [[NSAppleScript alloc] initWithSource:applescriptPath];
                            NSDictionary *error = nil;
                            NSAppleEventDescriptor *result = [script executeAndReturnError:&error];
                            
                            if (!error && result) {
                                NSString *pathStr = [result stringValue];
                                if (pathStr && [pathStr length] > 0) {
                                    pptxPath = pathStr;
                                }
                            }
                        }
                    } @catch (NSException *e) {
                        // Ignora erro ao obter caminho
                    }
                    
                    if (activePres && [activePres respondsToSelector:@selector(slides)]) {
                        NSArray *slides = [activePres performSelector:@selector(slides)];
                        slideCount = slides ? [slides count] : 0;
                        
                        // Usa AppleScript inline para detectar slides ocultos (mais confiável)
                        NSString *applescript = @"tell application \"Microsoft Powerpoint\"\n"
                                                 @"\ttell active presentation\n"
                                                 @"\t\tset slideList to slides\n"
                                                 @"\t\tset hiddenSlides to {}\n"
                                                 @"\t\trepeat with aSlide in slideList\n"
                                                 @"\t\t\ttry\n"
                                                 @"\t\t\t\tset slideTransition to slide show transition of aSlide\n"
                                                 @"\t\t\t\tset isHidden to hidden of slideTransition\n"
                                                 @"\t\t\t\tif isHidden then\n"
                                                 @"\t\t\t\t\tset slideNumber to slide number of aSlide\n"
                                                 @"\t\t\t\t\tset end of hiddenSlides to slideNumber\n"
                                                 @"\t\t\t\tend if\n"
                                                 @"\t\t\tend try\n"
                                                 @"\t\tend repeat\n"
                                                 @"\t\treturn hiddenSlides\n"
                                                 @"\tend tell\n"
                                                 @"end tell";
                        
                        // Executa AppleScript diretamente
                        NSAppleScript *script = [[NSAppleScript alloc] initWithSource:applescript];
                        NSDictionary *errorDict = nil;
                        NSAppleEventDescriptor *result = [script executeAndReturnError:&errorDict];
                        
                        if (!errorDict && result) {
                            // Parse resultado do AppleScript (retorna lista de números)
                            NSInteger count = [result numberOfItems];
                            for (NSInteger i = 1; i <= count; i++) {
                                NSAppleEventDescriptor *item = [result descriptorAtIndex:i];
                                NSInteger slideNum = [item int32Value];
                                if (slideNum > 0) {
                                    [hiddenSlideNumbers addObject:@(slideNum)];
                                }
                            }
                        }
                        
                        // Calcula slides visíveis
                        visibleSlideCount = slideCount - [hiddenSlideNumbers count];
                        if (visibleSlideCount < 0) {
                            visibleSlideCount = slideCount;
                        }
                        
                        // Tenta detectar vídeo via Scripting Bridge diretamente (mais confiável que AppleScript)
                        if (currentSlide > 0 && activePres) {
                            @try {
                                NSArray *slides = [activePres performSelector:@selector(slides)];
                                NSUInteger slideCountUB = [slides count];
                                if (slides && currentSlide > 0 && (NSUInteger)currentSlide <= slideCountUB) {
                                    id currentSlideObj = [slides objectAtIndex:currentSlide - 1];
                                    if (currentSlideObj && [currentSlideObj respondsToSelector:@selector(shapes)]) {
                                        NSArray *shapes = [currentSlideObj performSelector:@selector(shapes)];
                                        
                                        NSMutableDictionary *mutableVideoInfo;
                                        if (videoInfo) {
                                            mutableVideoInfo = [videoInfo mutableCopy];
                                        } else {
                                            mutableVideoInfo = [NSMutableDictionary dictionary];
                                            mutableVideoInfo[@"hasVideo"] = @NO;
                                            mutableVideoInfo[@"isPlaying"] = @NO;
                                            mutableVideoInfo[@"duration"] = @0.0;
                                            mutableVideoInfo[@"currentTime"] = @0.0;
                                            mutableVideoInfo[@"remainingTime"] = @0.0;
                                            mutableVideoInfo[@"volume"] = @0.0;
                                            mutableVideoInfo[@"muted"] = @NO;
                                            mutableVideoInfo[@"fileName"] = @"";
                                            mutableVideoInfo[@"sourceUrl"] = @"";
                                        }
                                        
                                        for (id shape in shapes) {
                                            @try {
                                                // Verifica nome do shape (já sabemos que vídeos têm nomes específicos)
                                                NSString *shapeName = nil;
                                                @try {
                                                    id nameObj = [shape valueForKey:@"name"];
                                                    if (nameObj) {
                                                        if ([nameObj isKindOfClass:[NSString class]]) {
                                                            shapeName = (NSString*)nameObj;
                                                        } else if ([nameObj respondsToSelector:@selector(stringValue)]) {
                                                            shapeName = [nameObj stringValue];
                                                        }
                                                    }
                                                } @catch (NSException *e) {
                                                    // Ignora
                                                }
                                                
                                                // Estratégia 1: Verifica diretamente se tem propriedade mediaFormat
                                                BOOL hasMediaFormat = NO;
                                                id mediaFormat = nil;
                                                
                                                // Tenta obter mediaFormat usando múltiplos métodos
                                                @try {
                                                    mediaFormat = [shape valueForKey:@"mediaFormat"];
                                                    if (mediaFormat) {
                                                        hasMediaFormat = YES;
                                                    }
                                                } @catch (NSException *e) {
                                                    // Ignora
                                                }
                                                
                                                // Método alternativo: performSelector
                                                if (!hasMediaFormat && [shape respondsToSelector:@selector(mediaFormat)]) {
                                                    @try {
                                                        mediaFormat = [shape performSelector:@selector(mediaFormat)];
                                                        if (mediaFormat) {
                                                            hasMediaFormat = YES;
                                                        }
                                                    } @catch (NSException *e) {
                                                        // Ignora
                                                    }
                                                }
                                                
                                                // Se encontrou mediaFormat OU nome parece ser de vídeo, é um objeto de mídia
                                                BOOL isVideoShape = hasMediaFormat;
                                                
                                                // Verifica pelo nome também (fallback)
                                                if (!isVideoShape && shapeName) {
                                                    NSString *lowerName = [shapeName lowercaseString];
                                                    isVideoShape = ([lowerName containsString:@"video"] || 
                                                                   [lowerName containsString:@"timer"] ||
                                                                   [lowerName containsString:@"movie"] ||
                                                                   [lowerName containsString:@"mp4"] ||
                                                                   [lowerName containsString:@"youtube"]);
                                                }
                                                
                                                if (isVideoShape) {
                                                    mutableVideoInfo[@"hasVideo"] = @YES;
                                                    
                                                    // Tenta obter informações de tempo via Scripting Bridge diretamente
                                                    // (AppleScript parece ter limitações com mediaFormat)
                                                    @try {
                                                        // Tenta obter mediaFormat via Scripting Bridge
                                                        if (mediaFormat) {
                                                            // Lista de propriedades possíveis para tentar
                                                            NSArray *durationKeys = @[@"length", @"duration", @"totalTime"];
                                                            NSArray *currentTimeKeys = @[@"currentPosition", @"currentTime", @"position", @"time"];
                                                            NSArray *playingKeys = @[@"isPlaying", @"playing", @"playState"];
                                                            
                                                            // Tenta obter duração
                                                            for (NSString *key in durationKeys) {
                                                                @try {
                                                                    id value = [mediaFormat valueForKey:key];
                                                                    if (!value && [mediaFormat respondsToSelector:NSSelectorFromString(key)]) {
                                                                        value = [mediaFormat performSelector:NSSelectorFromString(key)];
                                                                    }
                                                                    
                                                                    if (value) {
                                                                        double durationValue = 0.0;
                                                                        if ([value respondsToSelector:@selector(doubleValue)]) {
                                                                            durationValue = [value doubleValue];
                                                                        } else if ([value isKindOfClass:[NSNumber class]]) {
                                                                            durationValue = [(NSNumber*)value doubleValue];
                                                                        }
                                                                        
                                                                        // Assume que está em milissegundos se > 1000, senão em segundos
                                                                        if (durationValue > 1000) {
                                                                            durationValue = durationValue / 1000.0;
                                                                        }
                                                                        
                                                                        if (durationValue > 0) {
                                                                            mutableVideoInfo[@"duration"] = @(durationValue);
                                                                            break;
                                                                        }
                                                                    }
                                                                } @catch (NSException *e) {
                                                                    // Ignora e tenta próximo
                                                                }
                                                            }
                                                            
                                                            // Tenta obter tempo atual
                                                            for (NSString *key in currentTimeKeys) {
                                                                @try {
                                                                    id value = [mediaFormat valueForKey:key];
                                                                    if (!value && [mediaFormat respondsToSelector:NSSelectorFromString(key)]) {
                                                                        value = [mediaFormat performSelector:NSSelectorFromString(key)];
                                                                    }
                                                                    
                                                                    if (value) {
                                                                        double timeValue = 0.0;
                                                                        if ([value respondsToSelector:@selector(doubleValue)]) {
                                                                            timeValue = [value doubleValue];
                                                                        } else if ([value isKindOfClass:[NSNumber class]]) {
                                                                            timeValue = [(NSNumber*)value doubleValue];
                                                                        }
                                                                        
                                                                        // Assume que está em milissegundos se > 1000, senão em segundos
                                                                        if (timeValue > 1000) {
                                                                            timeValue = timeValue / 1000.0;
                                                                        }
                                                                        
                                                                        if (timeValue >= 0) {
                                                                            mutableVideoInfo[@"currentTime"] = @(timeValue);
                                                                            
                                                                            // Calcula tempo restante
                                                                            double duration = [mutableVideoInfo[@"duration"] doubleValue];
                                                                            if (duration > 0) {
                                                                                double remaining = duration - timeValue;
                                                                                mutableVideoInfo[@"remainingTime"] = @(remaining > 0 ? remaining : 0.0);
                                                                            }
                                                                            break;
                                                                        }
                                                                    }
                                                                } @catch (NSException *e) {
                                                                    // Ignora e tenta próximo
                                                                }
                                                            }
                                                            
                                                            // Tenta obter status de reprodução
                                                            for (NSString *key in playingKeys) {
                                                                @try {
                                                                    id value = [mediaFormat valueForKey:key];
                                                                    if (!value && [mediaFormat respondsToSelector:NSSelectorFromString(key)]) {
                                                                        value = [mediaFormat performSelector:NSSelectorFromString(key)];
                                                                    }
                                                                    
                                                                    if (value) {
                                                                        BOOL playing = NO;
                                                                        if ([value respondsToSelector:@selector(boolValue)]) {
                                                                            playing = [value boolValue];
                                                                        } else if ([value isKindOfClass:[NSNumber class]]) {
                                                                            playing = [(NSNumber*)value boolValue];
                                                                        }
                                                                        
                                                                        mutableVideoInfo[@"isPlaying"] = @(playing);
                                                                        break;
                                                                    }
                                                                } @catch (NSException *e) {
                                                                    // Ignora e tenta próximo
                                                                }
                                                            }
                                                        }
                                                    } @catch (NSException *e) {
                                                        // Ignora erros
                                                    }
                                                    
                                                    // Fallback: Tenta obter informações de tempo diretamente do shape
                                                    if ([mutableVideoInfo[@"duration"] doubleValue] == 0.0) {
                                                        @try {
                                                            // Duração total (pode estar diretamente no shape)
                                                            id duration = [shape valueForKey:@"duration"];
                                                            if (!duration && [shape respondsToSelector:@selector(duration)]) {
                                                                duration = [shape performSelector:@selector(duration)];
                                                            }
                                                            
                                                            if (duration) {
                                                                double durationSeconds = 0.0;
                                                                if ([duration respondsToSelector:@selector(doubleValue)]) {
                                                                    durationSeconds = [duration doubleValue];
                                                                } else if ([duration isKindOfClass:[NSNumber class]]) {
                                                                    durationSeconds = [(NSNumber*)duration doubleValue];
                                                                }
                                                                
                                                                if (durationSeconds > 0) {
                                                                    mutableVideoInfo[@"duration"] = @(durationSeconds);
                                                                }
                                                            }
                                                        } @catch (NSException *e) {
                                                            // Ignora
                                                        }
                                                    }
                                                    
                                                    // Tenta obter informações de tempo via mediaFormat (método alternativo)
                                                    if (mediaFormat && [mutableVideoInfo[@"duration"] doubleValue] == 0.0) {
                                                        @try {
                                                            // Duração total via mediaFormat (em milissegundos ou segundos)
                                                            if ([mutableVideoInfo[@"duration"] doubleValue] == 0.0) {
                                                                id length = [mediaFormat valueForKey:@"length"];
                                                                if (!length && [mediaFormat respondsToSelector:@selector(length)]) {
                                                                    length = [mediaFormat performSelector:@selector(length)];
                                                                }
                                                                
                                                                if (length) {
                                                                    double lengthValue = 0.0;
                                                                    if ([length respondsToSelector:@selector(doubleValue)]) {
                                                                        lengthValue = [length doubleValue];
                                                                    } else if ([length isKindOfClass:[NSNumber class]]) {
                                                                        lengthValue = [(NSNumber*)length doubleValue];
                                                                    }
                                                                    
                                                                    // Assume que está em milissegundos se > 1000, senão em segundos
                                                                    if (lengthValue > 1000) {
                                                                        lengthValue = lengthValue / 1000.0;
                                                                    }
                                                                    
                                                                    if (lengthValue > 0) {
                                                                        mutableVideoInfo[@"duration"] = @(lengthValue);
                                                                    }
                                                                }
                                                            }
                                                            
                                                            // Tempo atual de reprodução
                                                            id currentPosition = [mediaFormat valueForKey:@"currentPosition"];
                                                            if (!currentPosition && [mediaFormat respondsToSelector:@selector(currentPosition)]) {
                                                                currentPosition = [mediaFormat performSelector:@selector(currentPosition)];
                                                            }
                                                            
                                                            // Tenta outros nomes de propriedade
                                                            if (!currentPosition) {
                                                                currentPosition = [mediaFormat valueForKey:@"currentTime"];
                                                            }
                                                            if (!currentPosition && [mediaFormat respondsToSelector:@selector(currentTime)]) {
                                                                currentPosition = [mediaFormat performSelector:@selector(currentTime)];
                                                            }
                                                            
                                                            if (currentPosition) {
                                                                double currentTimeValue = 0.0;
                                                                if ([currentPosition respondsToSelector:@selector(doubleValue)]) {
                                                                    currentTimeValue = [currentPosition doubleValue];
                                                                } else if ([currentPosition isKindOfClass:[NSNumber class]]) {
                                                                    currentTimeValue = [(NSNumber*)currentPosition doubleValue];
                                                                }
                                                                
                                                                // Assume que está em milissegundos se > 1000, senão em segundos
                                                                if (currentTimeValue > 1000) {
                                                                    currentTimeValue = currentTimeValue / 1000.0;
                                                                }
                                                                
                                                                if (currentTimeValue >= 0) {
                                                                    mutableVideoInfo[@"currentTime"] = @(currentTimeValue);
                                                                    
                                                                    // Calcula tempo restante
                                                                    double duration = [mutableVideoInfo[@"duration"] doubleValue];
                                                                    if (duration > 0) {
                                                                        double remaining = duration - currentTimeValue;
                                                                        mutableVideoInfo[@"remainingTime"] = @(remaining > 0 ? remaining : 0.0);
                                                                    }
                                                                }
                                                            }
                                                            
                                                            // Status de reprodução - tenta múltiplas propriedades
                                                            id isPlaying = nil;
                                                            NSArray *playingKeys = @[@"isPlaying", @"playing", @"playState"];
                                                            
                                                            for (NSString *key in playingKeys) {
                                                                @try {
                                                                    id value = [mediaFormat valueForKey:key];
                                                                    if (!value && [mediaFormat respondsToSelector:NSSelectorFromString(key)]) {
                                                                        value = [mediaFormat performSelector:NSSelectorFromString(key)];
                                                                    }
                                                                    
                                                                    if (value) {
                                                                        BOOL playing = NO;
                                                                        
                                                                        // playState pode ser um número (0=paused, 1=playing, etc)
                                                                        if ([key isEqualToString:@"playState"]) {
                                                                            if ([value respondsToSelector:@selector(intValue)]) {
                                                                                NSInteger state = [value intValue];
                                                                                playing = (state == 1 || state > 0); // 1 geralmente significa playing
                                                                            } else if ([value respondsToSelector:@selector(boolValue)]) {
                                                                                playing = [value boolValue];
                                                                            }
                                                                        } else {
                                                                            // Para isPlaying e playing, usa boolValue
                                                                            if ([value respondsToSelector:@selector(boolValue)]) {
                                                                                playing = [value boolValue];
                                                                            } else if ([value isKindOfClass:[NSNumber class]]) {
                                                                                playing = [(NSNumber*)value boolValue];
                                                                            }
                                                                        }
                                                                        
                                                                        if (playing) {
                                                                            mutableVideoInfo[@"isPlaying"] = @(playing);
                                                                            isPlaying = @YES; // Marca como encontrado
                                                                            break;
                                                                        }
                                                                    }
                                                                } @catch (NSException *e) {
                                                                    // Continua tentando
                                                                }
                                                            }
                                                            
                                                            // Se não encontrou no mediaFormat, tenta no shape
                                                            if (!isPlaying) {
                                                                id shapePlaying = [shape valueForKey:@"isPlaying"];
                                                                if (!shapePlaying && [shape respondsToSelector:@selector(isPlaying)]) {
                                                                    shapePlaying = [shape performSelector:@selector(isPlaying)];
                                                                }
                                                                
                                                                if (shapePlaying) {
                                                                    BOOL playing = NO;
                                                                    if ([shapePlaying respondsToSelector:@selector(boolValue)]) {
                                                                        playing = [shapePlaying boolValue];
                                                                    } else if ([shapePlaying isKindOfClass:[NSNumber class]]) {
                                                                        playing = [(NSNumber*)shapePlaying boolValue];
                                                                    }
                                                                    if (playing) {
                                                                        mutableVideoInfo[@"isPlaying"] = @(playing);
                                                                    }
                                                                }
                                                            }
                                                            
                                                        } @catch (NSException *e) {
                                                            // Ignora erros ao obter informações de tempo
                                                        }
                                                    }
                                                    
                                                    // Tenta obter nome do arquivo ou URL do vídeo - MÚLTIPLAS TENTATIVAS
                                                    @try {
                                                        NSString *filePath = nil;
                                                        NSString *fileName = nil;
                                                        
                                                        // Método 1: linkFormat -> sourceFullName
                                                        id linkFormat = [shape valueForKey:@"linkFormat"];
                                                        if (!linkFormat && [shape respondsToSelector:@selector(linkFormat)]) {
                                                            linkFormat = [shape performSelector:@selector(linkFormat)];
                                                        }
                                                        
                                                        if (linkFormat) {
                                                            // Tenta sourceFullName
                                                            id sourceFullName = [linkFormat valueForKey:@"sourceFullName"];
                                                            if (!sourceFullName && [linkFormat respondsToSelector:@selector(sourceFullName)]) {
                                                                sourceFullName = [linkFormat performSelector:@selector(sourceFullName)];
                                                            }
                                                            
                                                            if (sourceFullName) {
                                                                NSString *fileNameStr = nil;
                                                                if ([sourceFullName isKindOfClass:[NSString class]]) {
                                                                    fileNameStr = (NSString*)sourceFullName;
                                                                } else if ([sourceFullName respondsToSelector:@selector(stringValue)]) {
                                                                    fileNameStr = [sourceFullName stringValue];
                                                                }
                                                                
                                                                if (fileNameStr && [fileNameStr length] > 0) {
                                                                    filePath = fileNameStr;
                                                                }
                                                            }
                                                            
                                                            // Tenta outras propriedades do linkFormat
                                                            if (!filePath) {
                                                                NSArray *possibleKeys = @[@"sourcePath", @"path", @"fullName", @"name", @"filePath"];
                                                                for (NSString *key in possibleKeys) {
                                                                    @try {
                                                                        id value = [linkFormat valueForKey:key];
                                                                        if (!value && [linkFormat respondsToSelector:NSSelectorFromString(key)]) {
                                                                            value = [linkFormat performSelector:NSSelectorFromString(key)];
                                                                        }
                                                                        
                                                                        if (value) {
                                                                            NSString *strValue = nil;
                                                                            if ([value isKindOfClass:[NSString class]]) {
                                                                                strValue = (NSString*)value;
                                                                            } else if ([value respondsToSelector:@selector(stringValue)]) {
                                                                                strValue = [value stringValue];
                                                                            }
                                                                            
                                                                            if (strValue && [strValue length] > 0 && ([strValue hasPrefix:@"/"] || [strValue hasPrefix:@"file://"])) {
                                                                                filePath = strValue;
                                                                                break;
                                                                            }
                                                                        }
                                                                    } @catch (NSException *e) {
                                                                        // Continua tentando
                                                                    }
                                                                }
                                                            }
                                                        }
                                                        
                                                        // Método 2: Tenta obter diretamente do shape
                                                        if (!filePath) {
                                                            NSArray *possibleKeys = @[@"sourcePath", @"path", @"fullPath", @"filePath", @"mediaPath"];
                                                            for (NSString *key in possibleKeys) {
                                                                @try {
                                                                    id value = [shape valueForKey:key];
                                                                    if (!value && [shape respondsToSelector:NSSelectorFromString(key)]) {
                                                                        value = [shape performSelector:NSSelectorFromString(key)];
                                                                    }
                                                                    
                                                                    if (value) {
                                                                        NSString *strValue = nil;
                                                                        if ([value isKindOfClass:[NSString class]]) {
                                                                            strValue = (NSString*)value;
                                                                        } else if ([value respondsToSelector:@selector(stringValue)]) {
                                                                            strValue = [value stringValue];
                                                                        }
                                                                        
                                                                        if (strValue && [strValue length] > 0 && ([strValue hasPrefix:@"/"] || [strValue hasPrefix:@"file://"])) {
                                                                            filePath = strValue;
                                                                            break;
                                                                        }
                                                                    }
                                                                } @catch (NSException *e) {
                                                                    // Continua tentando
                                                                }
                                                            }
                                                        }
                                                        
                                                        // Método 3: Tenta obter apenas o nome do shape
                                                        id name = [shape valueForKey:@"name"];
                                                        if (!name && [shape respondsToSelector:@selector(name)]) {
                                                            name = [shape performSelector:@selector(name)];
                                                        }
                                                        
                                                        if (name) {
                                                            NSString *nameStr = nil;
                                                            if ([name isKindOfClass:[NSString class]]) {
                                                                nameStr = (NSString*)name;
                                                            } else if ([name respondsToSelector:@selector(stringValue)]) {
                                                                nameStr = [name stringValue];
                                                            }
                                                            
                                                            if (nameStr && [nameStr length] > 0) {
                                                                fileName = nameStr;
                                                            }
                                                        }
                                                        
                                                        // Salva os valores encontrados
                                                        if (filePath && [filePath length] > 0) {
                                                            mutableVideoInfo[@"sourceUrl"] = filePath;
                                                            if (!fileName) {
                                                                fileName = [filePath lastPathComponent];
                                                            }
                                                        }
                                                        
                                                        if (fileName && [fileName length] > 0) {
                                                            mutableVideoInfo[@"fileName"] = fileName;
                                                        }
                                                        
                                                        // Tenta obter duração do arquivo se tiver o caminho (vídeo linkado externamente)
                                                        if (filePath && [filePath length] > 0 && [mutableVideoInfo[@"duration"] doubleValue] == 0.0) {
                                                            // Limpa o caminho se tiver prefixo file://
                                                            NSString *cleanPath = filePath;
                                                            if ([cleanPath hasPrefix:@"file://"]) {
                                                                cleanPath = [cleanPath stringByReplacingOccurrencesOfString:@"file://" withString:@""];
                                                            }
                                                            
                                                            // Verifica se o arquivo existe
                                                            if ([[NSFileManager defaultManager] fileExistsAtPath:cleanPath]) {
                                                                double fileDuration = getVideoDurationFromFile(cleanPath);
                                                                if (fileDuration > 0) {
                                                                    mutableVideoInfo[@"duration"] = @(fileDuration);
                                                                }
                                                            }
                                                        }
                                                        
                                                        // Se ainda não tem duração e tem fileName, tenta buscar o arquivo na máquina
                                                        if ([mutableVideoInfo[@"duration"] doubleValue] == 0.0 && fileName && [fileName length] > 0 && (!filePath || [filePath length] == 0)) {
                                                            // Procura o arquivo em locais comuns
                                                            NSArray *searchPaths = @[
                                                                [@"~/Downloads" stringByExpandingTildeInPath],
                                                                [@"~/Documents" stringByExpandingTildeInPath],
                                                                [@"~/Movies" stringByExpandingTildeInPath],
                                                                [@"~/Desktop" stringByExpandingTildeInPath]
                                                            ];
                                                            
                                                            for (NSString *searchPath in searchPaths) {
                                                                @try {
                                                                    NSString *potentialPath = [searchPath stringByAppendingPathComponent:fileName];
                                                                    if ([[NSFileManager defaultManager] fileExistsAtPath:potentialPath]) {
                                                                        double fileDuration = getVideoDurationFromFile(potentialPath);
                                                                        if (fileDuration > 0) {
                                                                            mutableVideoInfo[@"duration"] = @(fileDuration);
                                                                            mutableVideoInfo[@"sourceUrl"] = potentialPath;
                                                                            break;
                                                                        }
                                                                    }
                                                                } @catch (NSException *e) {
                                                                    // Continua procurando
                                                                }
                                                            }
                                                        }
                                                        
                                                        // ÚLTIMA TENTATIVA: Se ainda não temos duração e temos o caminho do .pptx,
                                                        // tenta extrair o vídeo do .pptx para obter a duração
                                                        // Esta é a única forma confiável de obter duração para vídeos incorporados
                                                        if ([mutableVideoInfo[@"duration"] doubleValue] == 0.0 && pptxPath) {
                                                            // Verifica se o arquivo existe antes de tentar
                                                            BOOL fileExists = [[NSFileManager defaultManager] fileExistsAtPath:pptxPath];
                                                            
                                                            if (fileExists) {
                                                                // Tenta com o nome do arquivo se tiver
                                                                double pptxDuration = getVideoDurationFromPPTX(pptxPath, fileName);
                                                                
                                                                // Se não encontrou com nome específico, tenta sem nome (pega primeiro vídeo)
                                                                if (pptxDuration == 0.0 && fileName && [fileName length] > 0) {
                                                                    pptxDuration = getVideoDurationFromPPTX(pptxPath, nil);
                                                                }
                                                                
                                                                // Se ainda não encontrou, tenta sem nome desde o início
                                                                if (pptxDuration == 0.0) {
                                                                    pptxDuration = getVideoDurationFromPPTX(pptxPath, nil);
                                                                }
                                                                
                                                                if (pptxDuration > 0) {
                                                                    mutableVideoInfo[@"duration"] = @(pptxDuration);
                                                                }
                                                            }
                                                        }
                                                    } @catch (NSException *e) {
                                                        // Ignora erros ao obter nome/URL
                                                    }
                                                    
                                                    // Tenta obter informações de volume
                                                    @try {
                                                        if (mediaFormat) {
                                                            id volume = [mediaFormat valueForKey:@"volume"];
                                                            if (!volume && [mediaFormat respondsToSelector:@selector(volume)]) {
                                                                volume = [mediaFormat performSelector:@selector(volume)];
                                                            }
                                                            
                                                            if (volume) {
                                                                double volumeValue = 0.0;
                                                                if ([volume respondsToSelector:@selector(doubleValue)]) {
                                                                    volumeValue = [volume doubleValue];
                                                                } else if ([volume isKindOfClass:[NSNumber class]]) {
                                                                    volumeValue = [(NSNumber*)volume doubleValue];
                                                                }
                                                                
                                                                // Volume pode estar em 0-100 ou 0-1
                                                                if (volumeValue > 1.0) {
                                                                    volumeValue = volumeValue / 100.0;
                                                                }
                                                                
                                                                mutableVideoInfo[@"volume"] = @(volumeValue);
                                                            }
                                                            
                                                            id muted = [mediaFormat valueForKey:@"muted"];
                                                            if (!muted && [mediaFormat respondsToSelector:@selector(muted)]) {
                                                                muted = [mediaFormat performSelector:@selector(muted)];
                                                            }
                                                            
                                                            if (muted) {
                                                                BOOL isMuted = NO;
                                                                if ([muted respondsToSelector:@selector(boolValue)]) {
                                                                    isMuted = [muted boolValue];
                                                                } else if ([muted isKindOfClass:[NSNumber class]]) {
                                                                    isMuted = [(NSNumber*)muted boolValue];
                                                                }
                                                                
                                                                mutableVideoInfo[@"muted"] = @(isMuted);
                                                            }
                                                        }
                                                    } @catch (NSException *e) {
                                                        // Ignora erros ao obter volume
                                                    }
                                                    
                                                    // Se conseguiu detectar vídeo, pode parar
                                                    break;
                                                }
                                            } @catch (NSException *e) {
                                                // Ignora erros ao processar uma forma específica
                                            }
                                        }
                                        
                                        // ÚLTIMA TENTATIVA: Só força isPlaying se estiver REALMENTE em modo de apresentação
                                        // (não apenas se detectou que pode estar)
                                        // Para vídeos linkados, o PowerPoint pode não expor isPlaying mesmo quando está tocando
                                        // Mas só fazemos isso quando temos certeza que está em apresentação
                                        // NOTA: isInSlideShow já foi verificado e atualizado anteriormente
                                        
                                                // SEMPRE tenta obter dados do vídeo via AppleScript quando encontrar um vídeo
                                        // AppleScript é mais confiável para isPlaying, currentPosition e duration
                                        // IMPORTANTE: Para vídeos incorporados, a duração só fica disponível após iniciar a reprodução
                                        if ([mutableVideoInfo[@"hasVideo"] boolValue]) {
                                            @try {
                                                // Tenta obter dados do vídeo via AppleScript
                                                // Para vídeos incorporados, precisamos garantir que o media format está acessível
                                                NSString *appleScriptStr = [NSString stringWithFormat:
                                                    @"tell application \"Microsoft Powerpoint\"\n"
                                                    @"\ttell active presentation\n"
                                                    @"\t\ttell slide %ld\n"
                                                    @"\t\t\tset shapeList to shapes\n"
                                                    @"\t\t\tset videoFound to false\n"
                                                    @"\t\t\trepeat with aShape in shapeList\n"
                                                    @"\t\t\t\ttry\n"
                                                    @"\t\t\t\tset shapeTypeNum to type of aShape as integer\n"
                                                    @"\t\t\t\tif shapeTypeNum is 17 then\n"
                                                    @"\t\t\t\t\tset videoFound to true\n"
                                                    @"\t\t\t\t\tset mf to media format of aShape\n"
                                                    @"\t\t\t\t\ttry\n"
                                                    @"\t\t\t\t\tset len to length of mf\n"
                                                    @"\t\t\t\t\tset pos to current position of mf\n"
                                                    @"\t\t\t\tset play to is playing of mf\n"
                                                    @"\t\t\t\t-- Para vídeos incorporados, len pode ser 0 até iniciar reprodução\n"
                                                    @"\t\t\t\treturn {len, pos, play}\n"
                                                    @"\t\t\t\ton error errMsg\n"
                                                    @"\t\t\t\t-- Se der erro ao acessar propriedades, tenta uma por vez\n"
                                                    @"\t\t\t\tset len to 0\n"
                                                    @"\t\t\t\tset pos to 0\n"
                                                    @"\t\t\t\tset play to false\n"
                                                    @"\t\t\t\ttry\n"
                                                    @"\t\t\t\tset len to length of mf\n"
                                                    @"\t\t\t\tend try\n"
                                                    @"\t\t\t\ttry\n"
                                                    @"\t\t\t\tset pos to current position of mf\n"
                                                    @"\t\t\t\tend try\n"
                                                    @"\t\t\t\ttry\n"
                                                    @"\t\t\t\tset play to is playing of mf\n"
                                                    @"\t\t\t\tend try\n"
                                                    @"\t\t\t\treturn {len, pos, play}\n"
                                                    @"\t\t\t\tend try\n"
                                                    @"\t\t\t\tend if\n"
                                                    @"\t\t\tend try\n"
                                                    @"\t\t\tend repeat\n"
                                                    @"\t\t\tif not videoFound then\n"
                                                    @"\t\t\t\treturn {0, 0, false}\n"
                                                    @"\t\t\tend if\n"
                                                    @"\t\tend tell\n"
                                                    @"\tend tell\n"
                                                    @"end tell", (long)currentSlide];
                                                
                                                NSAppleScript *videoScript = [[NSAppleScript alloc] initWithSource:appleScriptStr];
                                                NSDictionary *errorDict = nil;
                                                NSAppleEventDescriptor *videoResult = [videoScript executeAndReturnError:&errorDict];
                                                
                                                // Verifica se há erro no AppleScript
                                                if (errorDict) {
                                                    // Há erro no AppleScript - pode ser que o slide não tenha vídeo ou não está acessível
                                                    // Não faz nada, continua com dados do Scripting Bridge
                                                }
                                                
                                                // Tenta obter dados do resultado
                                                // IMPORTANTE: videoResult pode ser nil se o AppleScript falhou completamente
                                                // ou pode retornar uma lista mesmo com erros parciais
                                                if (videoResult) {
                                                    NSInteger itemCount = [videoResult numberOfItems];
                                                    if (itemCount >= 3) {
                                                    // Parse resultado: {length, currentPosition, isPlaying}
                                                    NSAppleEventDescriptor *lengthDesc = [videoResult descriptorAtIndex:1];
                                                    NSAppleEventDescriptor *positionDesc = [videoResult descriptorAtIndex:2];
                                                    NSAppleEventDescriptor *playingDesc = [videoResult descriptorAtIndex:3];
                                                    
                                                    // Tenta obter duração (pode estar em milissegundos ou segundos)
                                                    if (lengthDesc) {
                                                        @try {
                                                            double lengthValue = 0.0;
                                                            
                                                            // Tenta como int32 primeiro
                                                            @try {
                                                                lengthValue = [lengthDesc int32Value];
                                                            } @catch (NSException *e1) {
                                                                // Se falhar, tenta como double
                                                                @try {
                                                                    lengthValue = [lengthDesc doubleValue];
                                                                } @catch (NSException *e2) {
                                                                    // Se falhar, tenta como string
                                                                    @try {
                                                                        NSString *strValue = [lengthDesc stringValue];
                                                                        lengthValue = [strValue doubleValue];
                                                                    } @catch (NSException *e3) {
                                                                        // Ignora
                                                                    }
                                                                }
                                                            }
                                                            
                                                            // Aceita valores > 0 (mesmo que pequeno, pode ser duração válida)
                                                            // IMPORTANTE: Para vídeos incorporados, mesmo tocando, len pode ser 0
                                                            // mas se pos > 0, sabemos que está tocando
                                                            if (lengthValue > 0) {
                                                                // Se o valor for muito grande (> 3600000 ms = 1 hora), assume que já está em segundos
                                                                // Senão, assume que está em milissegundos e converte
                                                                if (lengthValue < 3600000) {
                                                                    lengthValue = lengthValue / 1000.0;
                                                                }
                                                                mutableVideoInfo[@"duration"] = @(lengthValue);
                                                            }
                                                            // Se lengthValue == 0, não atualiza (mantém o que já tinha ou 0)
                                                        } @catch (NSException *e) {
                                                            // Ignora se não for um número
                                                        }
                                                    }
                                                    
                                                    // Tenta obter posição atual (pode estar em milissegundos ou segundos)
                                                    if (positionDesc) {
                                                        @try {
                                                            double positionValue = 0.0;
                                                            
                                                            // Tenta como int32 primeiro
                                                            @try {
                                                                positionValue = [positionDesc int32Value];
                                                            } @catch (NSException *e1) {
                                                                // Se falhar, tenta como double
                                                                @try {
                                                                    positionValue = [positionDesc doubleValue];
                                                                } @catch (NSException *e2) {
                                                                    // Se falhar, tenta como string
                                                                    @try {
                                                                        NSString *strValue = [positionDesc stringValue];
                                                                        positionValue = [strValue doubleValue];
                                                                    } @catch (NSException *e3) {
                                                                        // Ignora
                                                                    }
                                                                }
                                                            }
                                                            
                                                            if (positionValue >= 0) {
                                                                // Se o valor for muito grande (> 3600000 ms = 1 hora), assume que já está em segundos
                                                                // Senão, assume que está em milissegundos e converte
                                                                if (positionValue < 3600000) {
                                                                    positionValue = positionValue / 1000.0;
                                                                }
                                                                mutableVideoInfo[@"currentTime"] = @(positionValue);
                                                                
                                                                // Calcula tempo restante
                                                                double duration = [mutableVideoInfo[@"duration"] doubleValue];
                                                                if (duration > 0) {
                                                                    double remaining = duration - positionValue;
                                                                    mutableVideoInfo[@"remainingTime"] = @(remaining > 0 ? remaining : 0.0);
                                                                }
                                                            }
                                                        } @catch (NSException *e) {
                                                            // Ignora se não for um número
                                                        }
                                                    }
                                                    
                                                            // OBTÉM STATUS DE REPRODUÇÃO via AppleScript (mais confiável)
                                                    if (playingDesc) {
                                                        @try {
                                                            BOOL playing = NO;
                                                            DescType descType = [playingDesc descriptorType];
                                                            
                                                            // Tenta múltiplas formas de obter o valor booleano
                                                            // 1. Verifica se é boolean direto
                                                            if (descType == typeBoolean) {
                                                                playing = [playingDesc booleanValue];
                                                            } else {
                                                                // 2. Tenta como número (0 = false, != 0 = true)
                                                                @try {
                                                                    NSInteger intValue = [playingDesc int32Value];
                                                                    playing = (intValue != 0);
                                                                } @catch (NSException *e1) {
                                                                    // 3. Tenta como double
                                                                    @try {
                                                                        double doubleValue = [playingDesc doubleValue];
                                                                        playing = (doubleValue != 0.0);
                                                                    } @catch (NSException *e2) {
                                                                        // 4. Tenta como string
                                                                        @try {
                                                                            NSString *strValue = [playingDesc stringValue];
                                                                            NSString *lowerStr = [strValue lowercaseString];
                                                                            playing = ([lowerStr isEqualToString:@"true"] || 
                                                                                       [lowerStr isEqualToString:@"yes"] ||
                                                                                       [lowerStr isEqualToString:@"1"] ||
                                                                                       [lowerStr isEqualToString:@"playing"]);
                                                                        } @catch (NSException *e3) {
                                                                            // 5. Última tentativa: usa booleanValue mesmo se não for typeBoolean
                                                                            @try {
                                                                                playing = [playingDesc booleanValue];
                                                                            } @catch (NSException *e4) {
                                                                                playing = NO;
                                                                            }
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                            
                                                            // Atualiza isPlaying com o valor obtido do AppleScript
                                                            // IMPORTANTE: Atualiza sempre, mas se playing for YES, é definitivo
                                                            // Se playing for NO, atualiza mas pode ser sobrescrito pela inferência depois
                                                            mutableVideoInfo[@"isPlaying"] = @(playing);
                                                        } @catch (NSException *e) {
                                                            // Ignora erros de parsing, vamos inferir depois
                                                        }
                                                    }
                                                    
                                                    // INFERÊNCIA INTELIGENTE: Detecta se vídeo está tocando mesmo quando o parse falhou
                                                    // Usa ScreenCaptureKit para interceptar áudio/vídeo do sistema como evidência adicional
                                                    @try {
                                                        double currentTime = [mutableVideoInfo[@"currentTime"] doubleValue];
                                                        double duration = [mutableVideoInfo[@"duration"] doubleValue];
                                                        BOOL currentIsPlaying = [mutableVideoInfo[@"isPlaying"] boolValue];
                                                        
                                                        // Usa interceptação de áudio/vídeo do sistema para confirmar se está tocando
                                                        BOOL audioDetected = NO;
                                                        BOOL videoDetected = NO;
                                                        if (pid > 0) {
                                                            NSLog(@"🎯 Chamando isAudioPlayingFromPowerPoint com PID %d...", pid);
                                                            audioDetected = isAudioPlayingFromPowerPoint(pid);
                                                            NSLog(@"🎯 isAudioPlayingFromPowerPoint retornou: %@", audioDetected ? @"SIM" : @"NÃO");
                                                            
                                                            NSLog(@"🎯 Chamando isVideoPlayingFromPowerPoint com PID %d...", pid);
                                                            videoDetected = isVideoPlayingFromPowerPoint(pid);
                                                            NSLog(@"🎯 isVideoPlayingFromPowerPoint retornou: %@", videoDetected ? @"SIM" : @"NÃO");
                                                        } else {
                                                            NSLog(@"⚠️ PID é 0 - não chamando interceptação");
                                                        }
                                                        
                                                        // Se interceptação detectou áudio ou vídeo, confirma que está tocando
                                                        if (!currentIsPlaying && (audioDetected || videoDetected)) {
                                                            mutableVideoInfo[@"isPlaying"] = @YES;
                                                            currentIsPlaying = YES;
                                                            
                                                            // Se temos duração capturada e não temos duração do PowerPoint, usa a capturada
                                                            if (g_captureState) {
                                                                if (duration == 0 && g_captureState.audioDuration > 0) {
                                                                    // Usa duração de áudio capturada como estimativa
                                                                    mutableVideoInfo[@"duration"] = @(g_captureState.audioDuration);
                                                                    duration = g_captureState.audioDuration;
                                                                    NSLog(@"💡 Usando duração capturada do áudio: %.2f segundos", g_captureState.audioDuration);
                                                                }
                                                                // Atualiza currentTime baseado na duração capturada
                                                                if (g_captureState.audioDuration > 0 && currentTime == 0) {
                                                                    mutableVideoInfo[@"currentTime"] = @(g_captureState.audioDuration);
                                                                    currentTime = g_captureState.audioDuration;
                                                                }
                                                            }
                                                        }
                                                        
                                                        // Se já detectou como tocando, atualiza remainingTime
                                                        if (currentIsPlaying && duration > 0) {
                                                            // Se currentTime é 0 mas está tocando, assume que está no início
                                                            // remainingTime = duration - currentTime
                                                            double remaining = duration - currentTime;
                                                            mutableVideoInfo[@"remainingTime"] = @(remaining > 0 ? remaining : 0.0);
                                                        } else if (!currentIsPlaying) {
                                                            // Se não detectou como tocando, tenta inferir do contexto
                                                            // IMPORTANTE: Para vídeos linkados, o PowerPoint pode não expor currentPosition
                                                            // mas podemos tentar inferir de outras formas
                                                            
                                                            BOOL shouldInferPlaying = NO;
                                                            
                                                            // Critério 1: Se currentTime > 0 (mesmo que pequeno), está tocando
                                                            if (currentTime > 0) {
                                                                shouldInferPlaying = YES;
                                                            }
                                                            // Critério 2: Se temos duration válida mas currentTime é 0,
                                                            // pode estar tocando mas o PowerPoint não está expondo a posição
                                                            // Neste caso, vamos assumir que se o usuário iniciou a reprodução, está tocando
                                                            // Mas isso é menos confiável, então não inferimos automaticamente
                                                            
                                                            if (shouldInferPlaying) {
                                                                mutableVideoInfo[@"isPlaying"] = @YES;
                                                                
                                                                // Calcula remainingTime se temos duration
                                                                if (duration > 0 && currentTime < duration) {
                                                                    double remaining = duration - currentTime;
                                                                    mutableVideoInfo[@"remainingTime"] = @(remaining > 0 ? remaining : 0.0);
                                                                }
                                                            }
                                                        }
                                                    } @catch (NSException *e) {
                                                        // Ignora
                                                    }
                                                    } else if (itemCount > 0 && itemCount < 3) {
                                                        // Retornou menos de 3 itens, mas tem algo - tenta obter o que tem
                                                        // (pode ser que algumas propriedades não estejam disponíveis)
                                                    }
                                                } else {
                                                    // videoResult é nil - AppleScript pode ter falhado completamente
                                                    // ou o vídeo não está acessível via AppleScript
                                                    // Tenta obter dados de outras formas
                                                    if (videoResult) {
                                                        @try {
                                                            // Tenta obter como lista
                                                            NSInteger itemCount = [videoResult numberOfItems];
                                                            if (itemCount > 0) {
                                                                // Se retornou lista com menos de 3 itens, tenta obter o que tem
                                                                if (itemCount >= 1) {
                                                                    NSAppleEventDescriptor *firstItem = [videoResult descriptorAtIndex:1];
                                                                    if (firstItem) {
                                                                        @try {
                                                                            double lengthValue = 0.0;
                                                                            
                                                                            // Tenta como int32 primeiro
                                                                            @try {
                                                                                lengthValue = [firstItem int32Value];
                                                                            } @catch (NSException *e1) {
                                                                                // Se falhar, tenta como double
                                                                                @try {
                                                                                    lengthValue = [firstItem doubleValue];
                                                                                } @catch (NSException *e2) {
                                                                                    // Se falhar, tenta como string
                                                                                    @try {
                                                                                        NSString *strValue = [firstItem stringValue];
                                                                                        lengthValue = [strValue doubleValue];
                                                                                    } @catch (NSException *e3) {
                                                                                        // Ignora
                                                                                    }
                                                                                }
                                                                            }
                                                                            
                                                                            if (lengthValue > 0) {
                                                                                if (lengthValue < 3600000) {
                                                                                    lengthValue = lengthValue / 1000.0;
                                                                                }
                                                                                mutableVideoInfo[@"duration"] = @(lengthValue);
                                                                            }
                                                                        } @catch (NSException *e) {
                                                                            // Ignora
                                                                        }
                                                                    }
                                                                }
                                                                if (itemCount >= 2) {
                                                                    NSAppleEventDescriptor *secondItem = [videoResult descriptorAtIndex:2];
                                                                    if (secondItem) {
                                                                        @try {
                                                                            double positionValue = 0.0;
                                                                            
                                                                            // Tenta como int32 primeiro
                                                                            @try {
                                                                                positionValue = [secondItem int32Value];
                                                                            } @catch (NSException *e1) {
                                                                                // Se falhar, tenta como double
                                                                                @try {
                                                                                    positionValue = [secondItem doubleValue];
                                                                                } @catch (NSException *e2) {
                                                                                    // Se falhar, tenta como string
                                                                                    @try {
                                                                                        NSString *strValue = [secondItem stringValue];
                                                                                        positionValue = [strValue doubleValue];
                                                                                    } @catch (NSException *e3) {
                                                                                        // Ignora
                                                                                    }
                                                                                }
                                                                            }
                                                                            
                                                                            if (positionValue >= 0) {
                                                                                if (positionValue < 3600000) {
                                                                                    positionValue = positionValue / 1000.0;
                                                                                }
                                                                                mutableVideoInfo[@"currentTime"] = @(positionValue);
                                                                                
                                                                                double duration = [mutableVideoInfo[@"duration"] doubleValue];
                                                                                if (duration > 0) {
                                                                                    double remaining = duration - positionValue;
                                                                                    mutableVideoInfo[@"remainingTime"] = @(remaining > 0 ? remaining : 0.0);
                                                                                }
                                                                                
                                                                                // Se tempo atual > 0, provavelmente está tocando (mesmo sem duration)
                                                                                if (positionValue > 0.1) {
                                                                                    mutableVideoInfo[@"isPlaying"] = @YES;
                                                                                    
                                                                                    // Se temos duration, calcula remainingTime
                                                                                    if (duration > 0) {
                                                                                        double remaining = duration - positionValue;
                                                                                        mutableVideoInfo[@"remainingTime"] = @(remaining > 0 ? remaining : 0.0);
                                                                                    }
                                                                                }
                                                                            }
                                                                        } @catch (NSException *e) {
                                                                            // Ignora
                                                                        }
                                                                    }
                                                                }
                                                                if (itemCount >= 3) {
                                                                    NSAppleEventDescriptor *thirdItem = [videoResult descriptorAtIndex:3];
                                                                    if (thirdItem) {
                                                                        DescType descType = [thirdItem descriptorType];
                                                                        if (descType == typeBoolean) {
                                                                            mutableVideoInfo[@"isPlaying"] = @([thirdItem booleanValue]);
                                                                        } else {
                                                                            NSInteger intValue = [thirdItem int32Value];
                                                                            mutableVideoInfo[@"isPlaying"] = @(intValue != 0);
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        } @catch (NSException *e) {
                                                            // Ignora erros
                                                        }
                                                    }
                                                }
                                                // Após tentar AppleScript, verifica novamente se precisa inferir isPlaying
                                                // IMPORTANTE: NÃO assumir isPlaying apenas porque está em modo de apresentação
                                                // Só assumir se tivermos evidência REAL de que está tocando
                                                if (![mutableVideoInfo[@"isPlaying"] boolValue]) {
                                                    double currentTime = [mutableVideoInfo[@"currentTime"] doubleValue];
                                                    
                                                    // ESTRATÉGIA ÚNICA: Só assume isPlaying se currentTime > 0
                                                    // Isso significa que o vídeo está realmente avançando
                                                    // Não assumir apenas por estar em modo de apresentação (evita falsos positivos)
                                                    if (currentTime > 0) {
                                                        mutableVideoInfo[@"isPlaying"] = @YES;
                                                    }
                                                    // REMOVIDO: Não assumir isPlaying só porque está em apresentação
                                                    // Isso causa falsos positivos quando o slide muda mas não há vídeo tocando
                                                    // ESTRATÉGIA 3: Tenta via Scripting Bridge novamente
                                                    else {
                                                        // Última tentativa: verifica se podemos obter o estado via Scripting Bridge
                                                        // em uma segunda passada (algumas vezes precisa de uma segunda tentativa)
                                                        @try {
                                                            if (currentSlide > 0 && activePres) {
                                                                NSArray *slides = [activePres performSelector:@selector(slides)];
                                                                if (slides && currentSlide > 0 && (NSUInteger)currentSlide <= [slides count]) {
                                                                    id currentSlideObj = [slides objectAtIndex:currentSlide - 1];
                                                                    if (currentSlideObj && [currentSlideObj respondsToSelector:@selector(shapes)]) {
                                                                        NSArray *shapes = [currentSlideObj performSelector:@selector(shapes)];
                                                                        for (id shape in shapes) {
                                                                            @try {
                                                                                id mediaFormat = [shape valueForKey:@"mediaFormat"];
                                                                                if (!mediaFormat && [shape respondsToSelector:@selector(mediaFormat)]) {
                                                                                    mediaFormat = [shape performSelector:@selector(mediaFormat)];
                                                                                }
                                                                                
                                                                                if (mediaFormat) {
                                                                                    // Tenta propriedades alternativas
                                                                                    NSArray *altPlayingKeys = @[@"isPlaying", @"playing", @"playState", @"paused"];
                                                                                    for (NSString *key in altPlayingKeys) {
                                                                                        @try {
                                                                                            id value = [mediaFormat valueForKey:key];
                                                                                            if (!value && [mediaFormat respondsToSelector:NSSelectorFromString(key)]) {
                                                                                                value = [mediaFormat performSelector:NSSelectorFromString(key)];
                                                                                            }
                                                                                            
                                                                                            if (value) {
                                                                                                BOOL playing = NO;
                                                                                                if ([value respondsToSelector:@selector(boolValue)]) {
                                                                                                    playing = [value boolValue];
                                                                                                    if ([key isEqualToString:@"paused"]) {
                                                                                                        playing = !playing; // Inverte se for paused
                                                                                                    }
                                                                                                } else if ([value isKindOfClass:[NSNumber class]]) {
                                                                                                    playing = [(NSNumber*)value boolValue];
                                                                                                    if ([key isEqualToString:@"paused"]) {
                                                                                                        playing = !playing;
                                                                                                    }
                                                                                                }
                                                                                                
                                                                                                if (playing) {
                                                                                                    mutableVideoInfo[@"isPlaying"] = @YES;
                                                                                                    break;
                                                                                                }
                                                                                            }
                                                                                        } @catch (NSException *e) {
                                                                                            // Continua tentando
                                                                                        }
                                                                                    }
                                                                                    break;
                                                                                }
                                                                            } @catch (NSException *e) {
                                                                                // Continua
                                                                            }
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        } @catch (NSException *e) {
                                                            // Ignora erros
                                                        }
                                                    }
                                                }
                                            } @catch (NSException *e) {
                                                // Ignora erros do AppleScript, usa dados do Scripting Bridge
                                            }
                                        }
                                        
                                        if ([mutableVideoInfo[@"hasVideo"] boolValue]) {
                                            videoInfo = mutableVideoInfo;
                                        }
                                    }
                                }
                            } @catch (NSException *e) {
                                // Ignora erros ao tentar detectar vídeo via Scripting Bridge
                            }
                        }
                        
                        // Código antigo removido - usando apenas Scripting Bridge agora
                        // (mantido apenas para referência histórica)
                        if (false && currentSlide > 0 && currentSlide <= slideCount) {
                            NSString *videoScript = [NSString stringWithFormat:
                                @"tell application \"Microsoft Powerpoint\"\n"
                                @"\ttell active presentation\n"
                                @"\t\ttell slide %ld\n"
                                @"\t\t\tset shapeList to shapes\n"
                                @"\t\t\tset videoFound to false\n"
                                @"\t\t\trepeat with aShape in shapeList\n"
                                @"\t\t\t\ttry\n"
                                @"\t\t\t\tset shapeTypeNum to type of aShape as integer\n"
                                @"\t\t\t\tif shapeTypeNum is 17 then\n"
                                @"\t\t\t\t\tset videoFound to true\n"
                                @"\t\t\t\t\texit repeat\n"
                                @"\t\t\t\tend if\n"
                                @"\t\t\tend try\n"
                                @"\t\t\tend repeat\n"
                                @"\t\t\treturn videoFound\n"
                                @"\t\tend tell\n"
                                @"\tend tell\n"
                                @"end tell", (long)currentSlide];
                            
                            NSAppleScript *videoScriptObj = [[NSAppleScript alloc] initWithSource:videoScript];
                            NSDictionary *videoErrorDict = nil;
                            NSAppleEventDescriptor *videoResult = [videoScriptObj executeAndReturnError:&videoErrorDict];
                            
                            if (!videoErrorDict && videoResult) {
                                BOOL hasVideoAppleScript = NO;
                                
                                // Tenta obter como boolean
                                if ([videoResult descriptorType] == typeBoolean) {
                                    hasVideoAppleScript = [videoResult booleanValue];
                                } else {
                                    // Tenta como integer
                                    NSInteger intValue = [videoResult int32Value];
                                    hasVideoAppleScript = (intValue != 0);
                                }
                                
                                if (hasVideoAppleScript) {
                                    // Atualiza informações de vídeo (marca como tendo vídeo, mas sem duração por enquanto)
                                    NSMutableDictionary *mutableVideoInfo;
                                    if (videoInfo) {
                                        mutableVideoInfo = [videoInfo mutableCopy];
                                    } else {
                                        mutableVideoInfo = [NSMutableDictionary dictionary];
                                        mutableVideoInfo[@"hasVideo"] = @NO;
                                        mutableVideoInfo[@"isPlaying"] = @NO;
                                        mutableVideoInfo[@"duration"] = @0.0;
                                        mutableVideoInfo[@"currentTime"] = @0.0;
                                        mutableVideoInfo[@"remainingTime"] = @0.0;
                                    }
                                    
                                    mutableVideoInfo[@"hasVideo"] = @YES;
                                    
                                    // Tenta obter duração via Scripting Bridge diretamente (mais seguro)
                                    @try {
                                        NSArray *slides = [activePres performSelector:@selector(slides)];
                                        if (slides && currentSlide > 0 && (NSUInteger)currentSlide <= [slides count]) {
                                            id currentSlideObj = [slides objectAtIndex:currentSlide - 1];
                                            if (currentSlideObj && [currentSlideObj respondsToSelector:@selector(shapes)]) {
                                                NSArray *shapes = [currentSlideObj performSelector:@selector(shapes)];
                                                for (id shape in shapes) {
                                                    @try {
                                                        // Verifica tipo via valueForKey (mais seguro)
                                                        id shapeType = [shape valueForKey:@"type"];
                                                        NSInteger typeNum = 0;
                                                        if ([shapeType respondsToSelector:@selector(intValue)]) {
                                                            typeNum = [shapeType intValue];
                                                        } else if ([shapeType isKindOfClass:[NSNumber class]]) {
                                                            typeNum = [(NSNumber*)shapeType intValue];
                                                        }
                                                        
                                                        // Tipo 17 = msoMedia
                                                        if (typeNum == 17) {
                                                            // Tenta obter mediaFormat e length
                                                            id mediaFormat = [shape valueForKey:@"mediaFormat"];
                                                            if (mediaFormat) {
                                                                id length = [mediaFormat valueForKey:@"length"];
                                                                if (length) {
                                                                    NSInteger lengthMs = 0;
                                                                    if ([length respondsToSelector:@selector(intValue)]) {
                                                                        lengthMs = [length intValue];
                                                                    } else if ([length isKindOfClass:[NSNumber class]]) {
                                                                        lengthMs = [(NSNumber*)length intValue];
                                                                    }
                                                                    
                                                                    if (lengthMs > 0) {
                                                                        mutableVideoInfo[@"duration"] = @(lengthMs / 1000.0);
                                                                        mutableVideoInfo[@"remainingTime"] = @(lengthMs / 1000.0);
                                                                    }
                                                                }
                                                            }
                                                            break; // Encontrou vídeo
                                                        }
                                                    } @catch (NSException *e) {
                                                        // Ignora erros
                                                    }
                                                }
                                            }
                                        }
                                    } @catch (NSException *e) {
                                        // Ignora erros ao tentar obter duração
                                    }
                                    
                                    videoInfo = mutableVideoInfo;
                                }
                            }
                        }
                    }
                    
                    if (isInSlideShow && activePres && [activePres respondsToSelector:@selector(slideShowWindows)]) {
                        NSArray *slideShowWindows = [activePres performSelector:@selector(slideShowWindows)];
                        if (!slideShowWindows || [slideShowWindows count] == 0) {
                            isInSlideShow = false;
                        }
                    }
                }
            } @catch (NSException *e) {
                // Se não conseguir contar visíveis, usa total
                if (visibleSlideCount == 0) {
                    visibleSlideCount = slideCount;
                }
            }
            
            // Calcula slides restantes baseado em slides visíveis
            NSInteger slidesRemaining = visibleSlideCount > 0 ? visibleSlideCount : slideCount;
            if (currentSlide > 0) {
                // Conta quantos slides visíveis restam após o atual
                if (visibleSlideCount > 0 && slideCount > 0) {
                    // Ajusta cálculo considerando slides ocultos
                    // Se o slide atual está antes de slides ocultos, precisa ajustar
                    NSInteger remaining = slideCount - currentSlide;
                    
                    // Subtrai slides ocultos que estão após o slide atual
                    for (NSNumber *hiddenNum in hiddenSlideNumbers) {
                        NSInteger hiddenSlideNum = [hiddenNum integerValue];
                        if (hiddenSlideNum > currentSlide) {
                            remaining--;
                        }
                    }
                    
                    slidesRemaining = remaining > 0 ? remaining : 0;
                } else {
                    slidesRemaining = slideCount - currentSlide;
                }
            }
            
            // Cria array de slides ocultos
            Napi::Array hiddenSlidesArray = Napi::Array::New(env);
            NSUInteger index = 0;
            for (NSNumber *hiddenNum in hiddenSlideNumbers) {
                hiddenSlidesArray[index++] = Napi::Number::New(env, [hiddenNum integerValue]);
            }
            
            result.Set("isAvailable", Napi::Boolean::New(env, true));
            result.Set("slideCount", Napi::Number::New(env, slideCount));
            result.Set("visibleSlideCount", Napi::Number::New(env, visibleSlideCount > 0 ? visibleSlideCount : slideCount));
            result.Set("currentSlide", Napi::Number::New(env, currentSlide));
            result.Set("isInSlideShow", Napi::Boolean::New(env, isInSlideShow));
            result.Set("slidesRemaining", Napi::Number::New(env, slidesRemaining));
            result.Set("hiddenSlides", hiddenSlidesArray);
            
            // Adiciona informações de vídeo se disponíveis
            if (videoInfo) {
                Napi::Object videoObj = Napi::Object::New(env);
                videoObj.Set("hasVideo", Napi::Boolean::New(env, [videoInfo[@"hasVideo"] boolValue]));
                videoObj.Set("isPlaying", Napi::Boolean::New(env, [videoInfo[@"isPlaying"] boolValue]));
                videoObj.Set("duration", Napi::Number::New(env, [videoInfo[@"duration"] doubleValue]));
                videoObj.Set("currentTime", Napi::Number::New(env, [videoInfo[@"currentTime"] doubleValue]));
                // Calcula remainingTime de forma mais robusta
                double remaining = [videoInfo[@"remainingTime"] doubleValue];
                double duration = [videoInfo[@"duration"] doubleValue];
                double currentTime = [videoInfo[@"currentTime"] doubleValue];
                BOOL isPlaying = [videoInfo[@"isPlaying"] boolValue];
                
                // Se remainingTime não foi calculado ou é inválido, calcula agora
                if (remaining <= 0 && duration > 0) {
                    remaining = duration - currentTime;
                }
                
                // Se está tocando mas remainingTime ainda é 0, e temos duration, 
                // assume que está no início (remaining = duration, já que currentTime = 0)
                if (isPlaying && remaining <= 0 && duration > 0 && currentTime <= 0) {
                    remaining = duration;
                }
                
                videoObj.Set("remainingTime", Napi::Number::New(env, remaining > 0 ? remaining : 0.0));
                
                // Adiciona propriedades adicionais se disponíveis
                if (videoInfo[@"volume"]) {
                    videoObj.Set("volume", Napi::Number::New(env, [videoInfo[@"volume"] doubleValue]));
                } else {
                    videoObj.Set("volume", Napi::Number::New(env, 0.0));
                }
                
                if (videoInfo[@"muted"]) {
                    videoObj.Set("muted", Napi::Boolean::New(env, [videoInfo[@"muted"] boolValue]));
                } else {
                    videoObj.Set("muted", Napi::Boolean::New(env, false));
                }
                
                if (videoInfo[@"fileName"]) {
                    NSString *fileName = videoInfo[@"fileName"];
                    videoObj.Set("fileName", Napi::String::New(env, [fileName UTF8String]));
                } else {
                    videoObj.Set("fileName", Napi::String::New(env, ""));
                }
                
                if (videoInfo[@"sourceUrl"]) {
                    NSString *sourceUrl = videoInfo[@"sourceUrl"];
                    videoObj.Set("sourceUrl", Napi::String::New(env, [sourceUrl UTF8String]));
                } else {
                    videoObj.Set("sourceUrl", Napi::String::New(env, ""));
                }
                
                result.Set("video", videoObj);
            } else {
                // Cria objeto vazio se não há vídeo
                Napi::Object videoObj = Napi::Object::New(env);
                videoObj.Set("hasVideo", Napi::Boolean::New(env, false));
                videoObj.Set("isPlaying", Napi::Boolean::New(env, false));
                videoObj.Set("duration", Napi::Number::New(env, 0.0));
                videoObj.Set("currentTime", Napi::Number::New(env, 0.0));
                videoObj.Set("remainingTime", Napi::Number::New(env, 0.0));
                videoObj.Set("volume", Napi::Number::New(env, 0.0));
                videoObj.Set("muted", Napi::Boolean::New(env, false));
                videoObj.Set("fileName", Napi::String::New(env, ""));
                videoObj.Set("sourceUrl", Napi::String::New(env, ""));
                result.Set("video", videoObj);
            }
            
        } @catch (NSException *e) {
            result.Set("isAvailable", Napi::Boolean::New(env, false));
            NSString *errorString = [NSString stringWithFormat:@"Erro: %@", [e reason]];
            result.Set("error", Napi::String::New(env, [errorString UTF8String]));
        }
    }
    
    return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "getPowerPointStatus"),
                Napi::Function::New(env, GetPowerPointStatus));
    return exports;
}

NODE_API_MODULE(powerpoint_macos, Init)

