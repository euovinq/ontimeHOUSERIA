// Implementação para Windows usando COM/ActiveX
// O PowerPoint no Windows expõe uma API COM muito mais rica que permite:
// - Obter duration, currentTime, isPlaying diretamente
// - Controlar reprodução
// - Acessar propriedades de vídeo em tempo real

#include <windows.h>
#include <comdef.h>
#include <comutil.h>
#include <napi.h>
#include <ole2.h>
#include <oleauto.h>

// Importa as interfaces do PowerPoint usando #import
// Isso gera wrappers C++ automaticamente para a API COM
#import "progid:PowerPoint.Application.16" rename_namespace("PowerPoint") \
    exclude("VARIANT", "GUID") \
    rename("DocumentProperties", "PPTDocumentProperties") \
    rename("RGB", "PPTRGB") \
    rename("SearchPath", "PPTSearchPath")

using namespace PowerPoint;

// Estrutura para armazenar informações de vídeo
struct VideoInfo {
    bool hasVideo;
    bool isPlaying;
    double duration;        // em segundos
    double currentTime;     // em segundos
    double remainingTime;   // em segundos
    double volume;          // 0.0 a 1.0
    bool muted;
    std::string fileName;
    std::string sourceUrl;
};

// Obtém informações de vídeo do PowerPoint via COM
VideoInfo GetVideoInfoFromPowerPoint() {
    VideoInfo info = {false, false, 0.0, 0.0, 0.0, 0.0, false, "", ""};
    
    try {
        // Inicializa COM se necessário
        CoInitialize(NULL);
        
        // Cria instância do PowerPoint
        _ApplicationPtr pptApp;
        HRESULT hr = pptApp.CreateInstance(__uuidof(Application));
        
        if (FAILED(hr) || !pptApp) {
            CoUninitialize();
            return info; // PowerPoint não está aberto
        }
        
        // Verifica se há apresentação ativa
        PresentationsPtr presentations = pptApp->Presentations;
        if (presentations->Count == 0) {
            CoUninitialize();
            return info; // Nenhuma apresentação aberta
        }
        
        PresentationPtr activePres = pptApp->ActivePresentation;
        if (!activePres) {
            CoUninitialize();
            return info;
        }
        
        // Obtém slide atual
        SlidePtr currentSlide = nullptr;
        bool inSlideShow = false;
        
        try {
            // Tenta obter de SlideShowWindow primeiro (modo apresentação)
            SlideShowWindowsPtr slideShowWindows = pptApp->SlideShowWindows;
            if (slideShowWindows->Count > 0) {
                SlideShowWindowPtr slideShowWindow = slideShowWindows->Item(1);
                SlideShowViewPtr view = slideShowWindow->View;
                currentSlide = view->Slide;
                inSlideShow = true;
            }
        } catch (...) {
            // Não está em apresentação
        }
        
        // Se não está em apresentação, tenta pegar do slide selecionado
        if (!currentSlide) {
            try {
                WindowsPtr windows = activePres->Windows;
                if (windows->Count > 0) {
                    WindowPtr window = windows->Item(1);
                    SelectionPtr selection = window->Selection;
                    SlideRangePtr slideRange = selection->SlideRange;
                    if (slideRange->Count > 0) {
                        currentSlide = slideRange->Item(1);
                    }
                }
            } catch (...) {
                // Ignora erros
            }
        }
        
        if (!currentSlide) {
            CoUninitialize();
            return info;
        }
        
        // Busca shapes no slide
        ShapesPtr shapes = currentSlide->Shapes;
        long shapeCount = shapes->Count;
        
        for (long i = 1; i <= shapeCount; i++) {
            ShapePtr shape = shapes->Item(i);
            
            // Verifica se é um objeto de mídia (tipo 16 = msoMediaType)
            // No Windows, o tipo pode ser verificado assim
            try {
                MsoShapeType shapeType = shape->Type;
                // msoMedia = 16
                if (shapeType == 16) { // msoMedia
                    info.hasVideo = true;
                    
                    // Obtém MediaFormat (interface mais rica no Windows!)
                    // Esta é a API que resolve tudo - muito melhor que macOS!
                    MediaFormatPtr mediaFormat = shape->MediaFormat;
                    
                    if (mediaFormat) {
                        // ✅ NO WINDOWS, TODAS ESSAS PROPRIEDADES ESTÃO DISPONÍVEIS DIRETAMENTE!
                        
                        // Obtém informações de reprodução
                        VARIANT_BOOL isPlaying = mediaFormat->IsPlaying;
                        info.isPlaying = (isPlaying != VARIANT_FALSE);
                        
                        // Obtém duração (em milissegundos)
                        long durationMs = mediaFormat->Length;
                        info.duration = durationMs / 1000.0; // Converte para segundos
                        
                        // Obtém posição atual (em milissegundos) - EM TEMPO REAL!
                        long currentTimeMs = mediaFormat->CurrentPosition;
                        info.currentTime = currentTimeMs / 1000.0; // Converte para segundos
                        
                        // Calcula tempo restante
                        info.remainingTime = info.duration - info.currentTime;
                        if (info.remainingTime < 0) {
                            info.remainingTime = 0;
                        }
                        
                        // Obtém volume (0-100)
                        long volumePercent = mediaFormat->Volume;
                        info.volume = volumePercent / 100.0;
                        
                        // Obtém mute
                        VARIANT_BOOL muted = mediaFormat->Muted;
                        info.muted = (muted != VARIANT_FALSE);
                        
                        // Obtém nome do arquivo
                        _bstr_t mediaName = mediaFormat->Name;
                        if (mediaName && strlen((char*)mediaName) > 0) {
                            info.fileName = std::string((char*)mediaName);
                        }
                    }
                    
                    // Tenta obter link do arquivo se disponível
                    try {
                        LinkFormatPtr linkFormat = shape->LinkFormat;
                        if (linkFormat) {
                            _bstr_t sourceFullName = linkFormat->SourceFullName;
                            if (sourceFullName && strlen((char*)sourceFullName) > 0) {
                                info.sourceUrl = std::string((char*)sourceFullName);
                            }
                        }
                    } catch (...) {
                        // Ignora erros ao obter link
                    }
                    
                    // Se encontrou vídeo, retorna (assume um vídeo por slide)
                    break;
                }
            } catch (...) {
                // Ignora erros ao processar shape
                continue;
            }
        }
        
        CoUninitialize();
        
    } catch (_com_error& e) {
        // Erro de COM
        CoUninitialize();
        return info;
    } catch (...) {
        // Outro erro
        CoUninitialize();
        return info;
    }
    
    return info;
}

// Função NAPI para obter status do PowerPoint
Napi::Object GetPowerPointStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    
    try {
        // Cria instância do PowerPoint
        _ApplicationPtr pptApp;
        HRESULT hr = pptApp.CreateInstance(__uuidof(Application));
        
        if (FAILED(hr) || !pptApp) {
            result.Set("isAvailable", Napi::Boolean::New(env, false));
            result.Set("error", Napi::String::New(env, "PowerPoint não está aberto"));
            return result;
        }
        
        PresentationsPtr presentations = pptApp->Presentations;
        if (presentations->Count == 0) {
            result.Set("isAvailable", Napi::Boolean::New(env, false));
            result.Set("error", Napi::String::New(env, "Nenhuma apresentação aberta"));
            return result;
        }
        
        PresentationPtr activePres = pptApp->ActivePresentation;
        if (!activePres) {
            result.Set("isAvailable", Napi::Boolean::New(env, false));
            result.Set("error", Napi::String::New(env, "Nenhuma apresentação ativa"));
            return result;
        }
        
        // Informações básicas
        result.Set("isAvailable", Napi::Boolean::New(env, true));
        result.Set("slideCount", Napi::Number::New(env, activePres->Slides->Count));
        
        // Obtém slide atual
        long currentSlide = 1;
        bool isInSlideShow = false;
        
        try {
            SlideShowWindowsPtr slideShowWindows = pptApp->SlideShowWindows;
            if (slideShowWindows->Count > 0) {
                SlideShowWindowPtr slideShowWindow = slideShowWindows->Item(1);
                SlideShowViewPtr view = slideShowWindow->View;
                SlidePtr slide = view->Slide;
                currentSlide = slide->SlideIndex;
                isInSlideShow = true;
            } else {
                // Não está em apresentação - usa seleção
                SelectionPtr selection = activePres->Windows->Item(1)->Selection;
                SlideRangePtr slideRange = selection->SlideRange;
                if (slideRange->Count > 0) {
                    currentSlide = slideRange->Item(1)->SlideIndex;
                }
            }
        } catch (...) {
            // Usa slide 1 como fallback
        }
        
        result.Set("currentSlide", Napi::Number::New(env, currentSlide));
        result.Set("isInSlideShow", Napi::Boolean::New(env, isInSlideShow));
        result.Set("slidesRemaining", Napi::Number::New(env, activePres->Slides->Count - currentSlide));
        
        // Obtém informações de vídeo
        VideoInfo videoInfo = GetVideoInfoFromPowerPoint();
        
        if (videoInfo.hasVideo) {
            Napi::Object videoObj = Napi::Object::New(env);
            videoObj.Set("hasVideo", Napi::Boolean::New(env, true));
            videoObj.Set("isPlaying", Napi::Boolean::New(env, videoInfo.isPlaying));
            videoObj.Set("duration", Napi::Number::New(env, videoInfo.duration));
            videoObj.Set("currentTime", Napi::Number::New(env, videoInfo.currentTime));
            videoObj.Set("remainingTime", Napi::Number::New(env, videoInfo.remainingTime));
            videoObj.Set("volume", Napi::Number::New(env, videoInfo.volume));
            videoObj.Set("muted", Napi::Boolean::New(env, videoInfo.muted));
            videoObj.Set("fileName", Napi::String::New(env, videoInfo.fileName));
            videoObj.Set("sourceUrl", Napi::String::New(env, videoInfo.sourceUrl));
            
            result.Set("video", videoObj);
        } else {
            Napi::Object videoObj = Napi::Object::New(env);
            videoObj.Set("hasVideo", Napi::Boolean::New(env, false));
            result.Set("video", videoObj);
        }
        
    } catch (_com_error& e) {
        result.Set("isAvailable", Napi::Boolean::New(env, false));
        _bstr_t errorMsg = e.ErrorMessage();
        result.Set("error", Napi::String::New(env, (char*)errorMsg));
    } catch (...) {
        result.Set("isAvailable", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "Erro desconhecido"));
    }
    
    return result;
}

// Inicialização do módulo
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(
        Napi::String::New(env, "getPowerPointStatus"),
        Napi::Function::New(env, GetPowerPointStatus)
    );
    return exports;
}

NODE_API_MODULE(powerpoint_windows, Init)

