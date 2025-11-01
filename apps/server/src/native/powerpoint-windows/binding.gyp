{
  "targets": [
    {
      "target_name": "powerpoint_windows",
      "sources": [
        "powerpoint_com.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": ["/EHsc"],
          "RuntimeLibrary": 2  // Multi-threaded DLL
        },
        "VCLinkerTool": {
          "AdditionalDependencies": [
            "ole32.lib",
            "oleaut32.lib",
            "comsuppw.lib"
          ]
        }
      },
      "conditions": [
        ["OS=='win'", {
          "sources": [ "powerpoint_com.cpp" ],
          "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ]
        }]
      ]
    }
  ]
}

