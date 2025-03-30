'use client'

import type React from 'react'

import { useEffect, useState } from 'react'
import {
  Upload,
  Camera,
  Download,
  BookImage,
  LoaderCircle,
  CheckCircleIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { execute } from 'wasm-imagemagick'
import { addMetadataToPng } from '@/pngUtil'
import { quote } from 'shell-quote'
import { checkFileType } from './utils'

export default function C2PAViewer() {
  const [image, setImage] = useState<{
    content: Uint8Array | null
    fileType: string
    fileName: string
    bloblURL: string
    mimeType: string
  }>({
    content: null,
    fileType: '',
    fileName: '',
    bloblURL: '',
    mimeType: '',
  })
  const [processedImageURL, setProcessedImageURL] = useState<{
    content: Uint8Array | ArrayBuffer | null
    blobURL: string
  }>({
    content: null,
    blobURL: '',
  })
  const [imageFormatError, setImageFormatError] = useState('')
  const [loading, setLoading] = useState({
    isUploading: false,
    isStripping: false,
    isAddingIphoneMetadata: false,
    isAddingPhotoshopMetadata: false,
    isAddingGimpMetadata: false,
  })
  const [currentState, setCurrentState] = useState('idle')

  useEffect(() => {
    const stripMetadata = async () => {
      if (image && image.content) {
        const extension = 'png' // TODO: Get extension from image
        const { outputFiles, exitCode, stderr } = await execute({
          inputFiles: [
            {
              name: image.fileName,
              content: image.content,
            },
          ],
          commands: [
            quote([
              'convert',
              image.fileName,
              '-strip',
              `cleaned.${extension}`,
            ]),
          ],
        })

        if (exitCode === 0 && outputFiles.length > 0 && outputFiles[0].buffer) {
          const outputBlobURL = URL.createObjectURL(outputFiles[0].blob)
          setProcessedImageURL({
            content: outputFiles[0].buffer,
            blobURL: outputBlobURL,
          })
          console.log('Stripped metadata from image')
          setCurrentState('stripped')
        } else {
          console.error(
            'Failed to strip metadata from image',
            stderr,
            exitCode,
            outputFiles
          )
          setImageFormatError('Failed to strip metadata from image')
          setImage({
            content: null,
            fileType: '',
            fileName: '',
            bloblURL: '',
            mimeType: '',
          })
        }
      }
    }

    stripMetadata()
  }, [image])

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLoading({ ...loading, isUploading: true })
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      const reader = new FileReader()
      reader.onload = async (event) => {
        if (event.target) {
          const content = new Uint8Array(event.target.result as ArrayBuffer)
          const { isSupported, mimeType } = await checkFileType(content)

          if (isSupported) {
            const blobURL = URL.createObjectURL(file)
            setImage({
              content: content,
              fileType: file.type,
              fileName: file.name,
              bloblURL: blobURL,
              mimeType: mimeType,
            })
            setCurrentState('uploaded')
          } else {
            console.error('Unsupported file type')
            setImageFormatError(
              'Unsupported file type. Currently only PNG files are supported.'
            )
          }
        }
      }
      reader.readAsArrayBuffer(file)
    }
    setLoading({ ...loading, isUploading: false })
  }

  const addMetadata = (type: 'iPhone' | 'Photoshop' | 'GIMP') => {
    if (type === 'iPhone') {
      setLoading({ ...loading, isAddingIphoneMetadata: true })
    } else if (type === 'Photoshop') {
      setLoading({ ...loading, isAddingPhotoshopMetadata: true })
    } else if (type === 'GIMP') {
      setLoading({ ...loading, isAddingGimpMetadata: true })
    }

    let metaData = {}

    if (type === 'iPhone') {
      metaData = {
        Make: 'Apple',
        Model: 'iPhone 14 Pro',
        Software: 'iOS 17.4',
        DateTime: '2025:03:30 14:15:22',
        ExposureTime: '1/120',
        FNumber: '1.78',
        ISO: '100',
        FocalLength: '6.86 mm',
        LensModel: 'iPhone 14 Pro Main Camera',
        Flash: 'Flash did not fire',
        GPSLatitude: '37.7749 N',
        GPSLongitude: '122.4194 W',
        ColorProfile: 'Display P3',
      }
    } else if (type === 'GIMP') {
      metaData = {
        Software: 'GIMP 2.10.36',
        DateTime: '2025:03:30 15:30:50',
        Artist: 'Anonymous Editor',
        Copyright: '© 2025 Anonymous',
        Comment: 'Created with GIMP',
        Compression: 'Deflate',
        ColorProfile: 'sRGB',
      }
    } else if (type === 'Photoshop') {
      metaData = {
        Software: 'Adobe Photoshop 2024',
        DateTime: '2025:03:30 12:45:10',
        Artist: 'Anonymous Designer',
        Copyright: '© 2025 Adobe Systems',
        Comment: 'Edited in Adobe Photoshop',
        ColorProfile: 'Adobe RGB',
        Compression: 'Uncompressed',
        ResolutionUnit: '2', // 2 = Inches
        XResolution: '300',
        YResolution: '300',
      }
    }

    if (processedImageURL.content) {
      const newBuffer = addMetadataToPng(processedImageURL.content, metaData)
      setProcessedImageURL({
        content: newBuffer,
        blobURL: URL.createObjectURL(
          new Blob([newBuffer], { type: image.mimeType })
        ),
      })
      console.log('Added metadata to image')
    }

    if (type === 'iPhone') {
      setLoading({ ...loading, isAddingIphoneMetadata: false })
    } else if (type === 'Photoshop') {
      setLoading({ ...loading, isAddingPhotoshopMetadata: false })
    } else if (type === 'GIMP') {
      setLoading({ ...loading, isAddingGimpMetadata: false })
    }
    setCurrentState('metadata-added')
  }

  return (
    <div className="relative container mx-auto px-4 py-8 w-full h-screen">
      <h1 className="text-3xl font-bold text-center mb-8">
        Forge C2PA: Manipulate Image Metadata
      </h1>

      <div className="w-full flex flex-col justify-center items-center mb-3">
        <p className="text-justify w-3/4">
          OpenAI’s latest image generation model signs images with a C2PA
          authority, marking them as AI-generated. This tool is a technical
          proof-of-concept to remove that signature. It also lets you add custom
          metadata, making the image appear as if it was created in Photoshop, a
          mobile camera, or GIMP. Right now, it only works for PNGs but keeps
          the image quality intact. This isn’t built for anything malicious—just
          an experiment to see what’s technically possible.
        </p>
        <ol className="list-decimal list-inside mt-1.5">
          <li>
            You can verify the original image’s C2PA signature at{' '}
            <a
              className="text-cyan-600 hover:underline underline-offset-4"
              target="_blank"
              href="https://contentcredentials.org/verify"
            >
              https://contentcredentials.org/verify
            </a>{' '}
            to check its authenticity.
          </li>
          <li>
            On this site, you can remove that authenticity data and replace it
            with fake metadata (iPhone, Photoshop etc..)
          </li>
          <li>
            You can then verify the modified metadata using online viewers like:{' '}
            <a
              className="text-cyan-600 hover:underline underline-offset-4"
              target="_blank"
              href="https://jimpl.com"
            >
              https://jimpl.com
            </a>
            ,{' '}
            <a
              className="text-cyan-600 hover:underline underline-offset-4"
              target="_blank"
              href="https://exif.tools"
            >
              https://exif.tools
            </a>
          </li>
        </ol>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 p-6 flex flex-col items-center justify-center min-h-[600px]">
          {image.content ? (
            <div className="relative w-full h-[600px]">
              {image.content && (
                <CheckCircleIcon className="w-6 h-6 absolute top-1 right-1 text-green-500" />
              )}
              <img
                src={image.bloblURL || '/placeholder.svg'}
                alt="Uploaded image"
                className="w-full h-full object-contain"
              />
            </div>
          ) : (
            <div className="relative flex flex-col items-center justify-center w-full h-full border-2 border-dashed border-gray-300 rounded-lg p-12">
              {loading.isUploading && (
                <LoaderCircle className="w-10 h-10 absolute top-5 right-5 animate-spin" />
              )}
              <Upload className="h-12 w-12 text-gray-400 mb-4" />
              <p className="text-sm text-gray-500 mb-4">
                Upload an image to view C2PA data
              </p>
              <Button className="relative">
                Choose Image
                <input
                  type="file"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={handleImageUpload}
                  accept="image/*"
                />
              </Button>

              {imageFormatError && (
                <p className="text-red-500 mt-3 text-sm text-center">
                  {imageFormatError}
                </p>
              )}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">
              Add <span className="text-[0.6rem] font-light">fake</span>{' '}
              Metadata
            </h2>
            <div className="space-y-3">
              <Button
                className="w-full justify-start"
                onClick={() => addMetadata('iPhone')}
                disabled={
                  !image ||
                  currentState === 'idle' ||
                  currentState === 'uploaded'
                }
              >
                <Camera />
                Add iPhone metadata
                {loading.isAddingIphoneMetadata && (
                  <LoaderCircle className="animate-spin w-8 h-8" />
                )}
              </Button>
              <Button
                className="w-full justify-start"
                onClick={() => addMetadata('Photoshop')}
                disabled={
                  !image ||
                  currentState === 'idle' ||
                  currentState === 'uploaded'
                }
              >
                <BookImage />
                Add Photoshop metadata
                {loading.isAddingPhotoshopMetadata && (
                  <LoaderCircle className="animate-spin w-8 h-8" />
                )}
              </Button>
              <Button
                className="w-full justify-start"
                onClick={() => addMetadata('GIMP')}
                disabled={
                  !image ||
                  currentState === 'idle' ||
                  currentState === 'uploaded'
                }
              >
                🐧 Add GIMP metadata
                {loading.isAddingGimpMetadata && (
                  <LoaderCircle className="animate-spin w-8 h-8" />
                )}
              </Button>
            </div>
          </Card>
          {currentState === 'stripped' && (
            <a href={processedImageURL.blobURL || ''} download={image.fileName}>
              <Button
                className="w-full"
                size="lg"
                disabled={!processedImageURL}
              >
                <Download className="mr-2 h-5 w-5" />
                Download stripped Image
              </Button>
            </a>
          )}
          {currentState === 'metadata-added' && (
            <a href={processedImageURL.blobURL || ''} download={image.fileName}>
              <Button
                className="w-full"
                size="lg"
                disabled={!processedImageURL}
              >
                <Download className="mr-2 h-5 w-5" />
                Download forged Image
              </Button>
            </a>
          )}
        </div>
      </div>

      <p className="w-full text-center mt-3">
        Built by{' '}
        <a
          href="https://github.com/CITIZENDOT"
          className="text-cyan-600 hover:underline underline-offset-4"
          target="_blank"
        >
          @CITIZENDOT
        </a>
      </p>
    </div>
  )
}
