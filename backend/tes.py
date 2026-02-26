from ultralytics import YOLO
model1 = YOLO("best.pt")
model = YOLO("last.pt")
print(model.names, model1.names)