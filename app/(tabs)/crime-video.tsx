import React, { useState, useRef, useEffect, useContext } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  StatusBar,
  Modal,
  TextInput,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import {
  Video,
  ArrowLeft,
  Image as ImageIcon,
  Pause,
  X,
  Check,
} from "lucide-react-native";
import { Camera as ExpoCamera, CameraView } from "expo-camera";
import * as MediaLibrary from "expo-media-library";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { PageHeader } from "@/components/PageHeader";
import LottieView from "lottie-react-native";
import emptyStateAnimation from "@/assets/animations/empty-state.json";
import styled from "styled-components/native";
import { WalletContext } from "../context/WalletContext";
import { generateAvatarUrl } from "../utils";
import { crimeContract, handleNewRecording } from "@/hooks/useCrimeContract";
import {
  executeCalls,
  fetchAccountCompatibility,
  fetchGasTokenPrices,
  GaslessOptions,
  GasTokenPrice,
  getGasFeesInGasToken,
  SEPOLIA_BASE_URL,
} from "@avnu/gasless-sdk";
import { Account, Call } from "starknet";
// import { useCrimeVideoContract } from "@/hooks/useCrimeContract";
// import { useSendTransaction } from "@starknet-react/core";

const options: GaslessOptions = { baseUrl: SEPOLIA_BASE_URL };

export default function VideoRecorderScreen() {
  const [showCamera, setShowCamera] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaType, setMediaType] = useState<"photo" | "video" | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [showNamingModal, setShowNamingModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [evidenceName, setEvidenceName] = useState("");
  const [capturedMedia, setCapturedMedia] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [gasTokenPrices, setGasTokenPrices] = useState<GasTokenPrice[]>([]);
  const [gasTokenPrice, setGasTokenPrice] = useState<GasTokenPrice>();
  const [maxGasTokenAmount, setMaxGasTokenAmount] = useState<bigint>();
  const [gaslessCompatibility, setGaslessCompatibility] = useState<any>();
  const [errorMessage, setErrorMessage] = useState<string>();

  const cameraRef = useRef<any>(null);
  const recordingTimer = useRef<NodeJS.Timeout | null>(null);

  const { SecureStore, ACCOUNT_STORE_KEY } = useContext(WalletContext);
  const response = SecureStore.getItem(ACCOUNT_STORE_KEY);
  const account = JSON.parse(response);
  const truncatedAddress = account[0].address.slice(0, 3).concat("...");

  useEffect(() => {
    return () => {
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (account) {
      fetchAccountCompatibility(account[0].address, options).then(
        setGaslessCompatibility
      );
      fetchGasTokenPrices(options).then(setGasTokenPrices);
    }
  }, [account]);

  const requestPermissions = async () => {
    const { status: cameraStatus } =
      await ExpoCamera.requestCameraPermissionsAsync();
    const { status: audioStatus } =
      await ExpoCamera.requestMicrophonePermissionsAsync();
    const { status: libraryStatus } =
      await MediaLibrary.requestPermissionsAsync();

    setHasPermission(
      cameraStatus === "granted" &&
        audioStatus === "granted" &&
        libraryStatus === "granted"
    );

    if (cameraStatus === "granted" && audioStatus === "granted") {
      setShowCamera(true);
    }
  };

  const handleBack = () => {
    if (isRecording) {
      stopRecording();
    }
    setShowCamera(false);
    setMediaType(null);
    setRecordingDuration(0);
  };

  const startRecording = async () => {
    if (cameraRef.current) {
      setIsRecording(true);
      setMediaType("video");
      setRecordingDuration(0);

      recordingTimer.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);

      try {
        const video = await cameraRef.current.recordAsync({
          maxDuration: 60,
          quality: "720p",
          mute: false,
          videoBitrate: 5000000,
        });

        if (video) {
          setCapturedMedia(video);
          setShowNamingModal(true);
        }
      } catch (error) {
        console.error("Error recording video:", error);
        setIsRecording(false);
      }
    }
  };

  const stopRecording = async () => {
    if (cameraRef.current && isRecording) {
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
      }
      setIsRecording(false);
      try {
        await cameraRef.current.stopRecording();
      } catch (error) {
        console.error("Error stopping recording:", error);
      }
    }
  };

  const takePicture = async () => {
    if (cameraRef.current) {
      setMediaType("photo");
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.8,
          base64: true,
        });
        if (photo) {
          setCapturedMedia(photo);
          setShowNamingModal(true);
        }
      } catch (error) {
        console.error("Error taking picture:", error);
      }
    }
  };

  const saveMedia = async () => {
    try {
      if (capturedMedia && crimeContract) {
        await MediaLibrary.saveToLibraryAsync(capturedMedia.uri);

        // Save to blockchain
        const videoData = {
          title: evidenceName,
          timestamp: new Date().toISOString(),
          uri: capturedMedia.uri,
        };

        await handleNewRecording(videoData);

        const calls: Call[] = [
          {
            entrypoint: "coverCrime",
            contractAddress: crimeContract.address,
            calldata: [videoData.uri],
          },
        ];

        setLoading(true);
        await executeCalls(
          account,
          calls,
          {
            gasTokenAddress: gasTokenPrice?.tokenAddress,
            maxGasTokenAmount,
          },
          options
        )
          .then((response) => {
            setLoading(false);
            setShowNamingModal(false);
            setShowSuccessModal(true);
            setTimeout(() => {
              setShowSuccessModal(false);
              handleBack();
            }, 2000);
          })
          .catch((error) => {
            setLoading(false);
            console.error("Error executing transaction:", error);
            setErrorMessage("Failed to execute transaction. Please try again.");
          });
      }
    } catch (error) {
      console.error("Error saving media:", error);
    }
  };

  // const formatDuration = (seconds: number) => {
  //     return `${String(seconds).padStart(2, '0')} sec`;
  // };

  const NamingModal = () => (
    <Modal transparent visible={showNamingModal} animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setShowNamingModal(false)}
          >
            <X color="#fff" style={{ marginBottom: 10 }} size={24} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>
            What would you like to name your evidence?
          </Text>
          <TextInput
            style={styles.evidenceInput}
            placeholder="Give Your Evidence a Name"
            placeholderTextColor="#666"
            value={evidenceName}
            onChangeText={setEvidenceName}
          />
          <TouchableOpacity onPress={saveMedia}>
            <Text style={styles.durationText}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  const SuccessModal = () => (
    <Modal transparent visible={showSuccessModal} animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.successIcon}>
            <Check color="#00FF00" size={40} />
          </View>
          <Text style={styles.modalTitle}>
            Your media is saved on the Blockchain
          </Text>
        </View>
      </View>
    </Modal>
  );

  if (showCamera) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />

        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <ArrowLeft color="#fff" size={24} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <LinearGradient
            colors={["#2D8EFF", "#9C3FE4"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.profileContainer}
          >
            <Image
              source={{ uri: generateAvatarUrl(account[0]?.address) }}
              style={styles.avatar}
            />
            <Text style={styles.walletAddress}>{truncatedAddress}</Text>
          </LinearGradient>
        </View>

        <Text style={styles.cameraText}>
          {isRecording
            ? "Recording in progress..."
            : mediaType === "photo"
            ? "Taking a picture..."
            : "You can record a video, or take a picture to keep on the blockchain"}
        </Text>

        <View style={styles.cameraContainer}>
          <CameraView ref={cameraRef} style={styles.camera} facing="back" />
          <View style={styles.cameraControls}>
            {isRecording ? (
              <TouchableOpacity
                style={[styles.cameraButton, styles.recordingButton]}
                onPress={stopRecording}
              >
                <Pause size={32} color="#FF4444" />
                <Text style={[styles.cameraButtonText, styles.recordingText]}>
                  Stop Recording
                </Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.cameraButton}
                  onPress={startRecording}
                >
                  <Video size={32} color="#2D8EFF" />
                  <Text style={styles.cameraButtonText}>Record a Video</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cameraButton}
                  onPress={takePicture}
                >
                  <ImageIcon size={32} color="#2D8EFF" />
                  <Text style={styles.cameraButtonText}>Take a Picture</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
        <NamingModal />
        <SuccessModal />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      <PageHeader title={"Video Recorder"} />

      <ThemedView style={styles.content}>
        <LottieContainer>
          <LottieView
            source={emptyStateAnimation}
            autoPlay
            loop
            style={{ width: 280, height: 280 }}
          />
        </LottieContainer>
        <ThemedText style={styles.message}>
          You have not saved any video or image {"\n"}on the blockchain yet.
          Launch your {"\n"}camera to record your evidence.
        </ThemedText>
        <TouchableOpacity onPress={requestPermissions}>
          <LinearGradient
            colors={["#2D8EFF", "#9C3FE4"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.recordButtonContainer}
          >
            <ThemedView style={styles.recordButton}>
              <ThemedText style={styles.recordButtonText}>
                Start Recording
              </ThemedText>
              <Video size={24} color="#fff" style={styles.recordIcon} />
            </ThemedView>
          </LinearGradient>
        </TouchableOpacity>
      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // backgroundColor: '#000',
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
  },
  backText: {
    color: "#fff",
    fontSize: 18,
    fontFamily: "Outfit-Regular",
    marginLeft: 8,
  },
  title: {
    fontFamily: "Outfit-SemiBold",
    fontSize: 24,
    fontWeight: "600",
    // color: '#fff',
  },
  profileContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 4,
    borderRadius: 20,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  walletAddress: {
    color: "#fff",
    fontFamily: "Outfit-Regular",
    marginLeft: 8,
    marginRight: 8,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: 5,
  },
  illustration: {
    width: 250,
    height: 250,
    marginBottom: 24,
  },
  message: {
    fontSize: 16,
    // color: '#fff',
    fontFamily: "Outfit-Regular",
    textAlign: "center",
    lineHeight: 24,
  },
  recordButtonContainer: {
    margin: 20,
    width: 292,
    borderRadius: 30,
    padding: 3,
  },
  recordButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    // backgroundColor: '#000',
    borderRadius: 30,
    paddingVertical: 16,
  },
  recordButtonText: {
    // color: '#fff',
    fontSize: 18,
    fontFamily: "Outfit-Regular",
    fontWeight: "500",
    marginRight: 8,
  },
  recordIcon: {
    marginLeft: 8,
  },
  cameraContainer: {
    flex: 1,
    width: "100%",
    // backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  cameraControls: {
    flexDirection: "row",
    justifyContent: "space-around",
    padding: 20,
    backgroundColor: "rgba(0,0,0,0.8)",
  },
  cameraButton: {
    alignItems: "center",
  },
  cameraButtonText: {
    color: "#fff",
    marginTop: 8,
    fontFamily: "Outfit-Regular",
  },
  cameraText: {
    color: "#fff",
    fontSize: 16,
    textAlign: "center",
    marginVertical: 20,
    fontFamily: "Outfit-Regular",
    paddingHorizontal: 20,
  },
  recordingButton: {
    backgroundColor: "rgba(255, 68, 68, 0.1)",
    padding: 16,
    borderRadius: 8,
  },
  recordingText: {
    color: "#FF4444",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "#1A1A1A",
    borderRadius: 20,
    padding: 25,
    width: "80%",
    height: 210,
    alignItems: "center",
  },
  modalTitle: {
    color: "#fff",
    fontSize: 20,
    fontFamily: "Outfit-SemiBold",
    textAlign: "center",
    marginBottom: 20,
  },
  evidenceInput: {
    backgroundColor: "#2A2A2A",
    borderRadius: 10,
    padding: 15,
    width: "100%",
    color: "#fff",
    fontFamily: "Outfit-Regular",
    marginBottom: 20,
  },
  durationText: {
    color: "#2D8EFF",
    fontSize: 24,
    fontFamily: "Outfit-SemiBold",
  },
  closeButton: {
    position: "absolute",
    right: 10,
    top: 10,
  },
  successIcon: {
    backgroundColor: "rgba(0, 255, 0, 0.1)",
    borderRadius: 50,
    padding: 20,
    marginBottom: 20,
  },
});
const LottieContainer = styled.View`
  width: 280px;
  height: 280px;
`;
