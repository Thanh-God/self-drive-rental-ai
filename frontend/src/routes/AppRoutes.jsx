import { Navigate, Route, Routes } from "react-router-dom";
import AdminLayout from "../layouts/AdminLayout";
import GuestLayout from "../layouts/GuestLayout";
import StaffLayout from "../layouts/StaffLayout";
import UserLayout from "../layouts/UserLayout";
import HomePage from "../pages/guest/HomePage";
import LoginPage from "../pages/guest/LoginPage";
import RegisterPage from "../pages/guest/RegisterPage";
import AccountsPage from "../pages/admin/AccountsPage";
import CatalogPage from "../pages/admin/CatalogPage";
import DashboardPage from "../pages/admin/DashboardPage";
import LocationsPage from "../pages/admin/LocationsPage";
import ReviewsModerationPage from "../pages/admin/ReviewsModerationPage";
import VehiclesManagePage from "../pages/admin/VehiclesManagePage";
import BookingQueuePage from "../pages/staff/BookingQueuePage";
import FleetStatusPage from "../pages/staff/FleetStatusPage";
import HandoverPage from "../pages/staff/HandoverPage";
import ReturnPage from "../pages/staff/ReturnPage";
import ItineraryPlannerPage from "../pages/shared/ItineraryPlannerPage";
import NotFoundPage from "../pages/shared/NotFoundPage";
import RecommendPage from "../pages/shared/RecommendPage";
import UnauthorizedPage from "../pages/shared/UnauthorizedPage";
import VehicleDetailPage from "../pages/shared/VehicleDetailPage";
import VehicleListPage from "../pages/shared/VehicleListPage";
import MyBookingsPage from "../pages/user/MyBookingsPage";
import ProfilePage from "../pages/user/ProfilePage";
import SavedItinerariesPage from "../pages/user/SavedItinerariesPage";
import { ROLES } from "../utils/roles";
import ProtectedRoute from "./ProtectedRoute";
import { DataGate } from "../components/common/PageKit";
import { DEMO_MODE } from "../demo/config";
import DemoAccess from "../pages/guest/DemoAccess";
import NewBookingPage from "../pages/user/NewBookingPage";
import {
  BookingDetailScreen,
  BookingListScreen,
  DocumentScreen,
  OperationScreen,
} from "../pages/shared/BookingScreens";
import { ItineraryDetailScreen } from "../pages/shared/AiScreens";

const screen = (element) => <DataGate>{element}</DataGate>;

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<GuestLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/vehicles" element={screen(<VehicleListPage />)} />
        <Route
          path="/vehicles/:vehicleId"
          element={screen(<VehicleDetailPage />)}
        />
        <Route path="/ai/recommend" element={screen(<RecommendPage />)} />
        <Route
          path="/ai/itinerary"
          element={screen(<ItineraryPlannerPage />)}
        />
        <Route
          path="/login"
          element={DEMO_MODE ? <DemoAccess /> : <LoginPage />}
        />
        <Route
          path="/register"
          element={DEMO_MODE ? <DemoAccess register /> : <RegisterPage />}
        />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route
        path="/user"
        element={
          <ProtectedRoute roles={[ROLES.USER]}>
            <UserLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="bookings" replace />} />
        <Route path="bookings" element={screen(<MyBookingsPage />)} />
        <Route path="bookings/new" element={screen(<NewBookingPage />)} />
        <Route
          path="bookings/:bookingId"
          element={screen(<BookingDetailScreen area="user" />)}
        />
        <Route
          path="bookings/:bookingId/contract"
          element={screen(<DocumentScreen area="user" kind="contract" />)}
        />
        <Route
          path="bookings/:bookingId/invoice"
          element={screen(<DocumentScreen area="user" kind="invoice" />)}
        />
        <Route path="itineraries" element={screen(<SavedItinerariesPage />)} />
        <Route
          path="itineraries/:itineraryId"
          element={screen(<ItineraryDetailScreen />)}
        />
        <Route path="profile" element={screen(<ProfilePage />)} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route
        path="/staff"
        element={
          <ProtectedRoute roles={[ROLES.STAFF]}>
            <StaffLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="queue" replace />} />
        <Route path="queue" element={screen(<BookingQueuePage />)} />
        <Route
          path="bookings"
          element={<Navigate to="/staff/queue" replace />}
        />
        <Route
          path="bookings/:bookingId"
          element={screen(<BookingDetailScreen area="staff" />)}
        />
        <Route
          path="bookings/:bookingId/contract"
          element={screen(<DocumentScreen area="staff" kind="contract" />)}
        />
        <Route
          path="bookings/:bookingId/invoice"
          element={screen(<DocumentScreen area="staff" kind="invoice" />)}
        />
        <Route path="handover" element={screen(<HandoverPage />)} />
        <Route
          path="handover/:bookingId"
          element={screen(<OperationScreen kind="handover" />)}
        />
        <Route path="return" element={screen(<ReturnPage />)} />
        <Route
          path="return/:bookingId"
          element={screen(<OperationScreen kind="return" />)}
        />
        <Route path="fleet" element={screen(<FleetStatusPage />)} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route
        path="/admin"
        element={
          <ProtectedRoute roles={[ROLES.ADMIN]}>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={screen(<DashboardPage />)} />
        <Route path="accounts" element={screen(<AccountsPage />)} />
        <Route path="vehicles" element={screen(<VehiclesManagePage />)} />
        <Route path="catalog" element={screen(<CatalogPage />)} />
        <Route path="locations" element={screen(<LocationsPage />)} />
        <Route path="reviews" element={screen(<ReviewsModerationPage />)} />
        <Route
          path="bookings"
          element={screen(<BookingListScreen area="admin" />)}
        />
        <Route
          path="bookings/:bookingId"
          element={screen(<BookingDetailScreen area="admin" />)}
        />
        <Route
          path="bookings/:bookingId/contract"
          element={screen(<DocumentScreen area="admin" kind="contract" />)}
        />
        <Route
          path="bookings/:bookingId/invoice"
          element={screen(<DocumentScreen area="admin" kind="invoice" />)}
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
